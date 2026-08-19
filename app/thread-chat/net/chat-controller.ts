/**
 * net/chat-controller —— 会话的「发送 / 重试 / 中止」统一入口。
 * （分支首答不再由这里触发：开分支只预填 composer，用户回车确认后走普通 send。）
 *
 * 消费真实 /api/chat SSE（见 ui-stream.ts），把正文增量喂回 store 的细粒度
 * mutator（pending → streaming → done/error）。
 *
 * 关键机制：
 *  - inflight：per-thread 的 AbortController，同一会话同时只允许一路在飞。
 *  - 合帧缓冲：text-delta 不直接进 store，先攒进 buffer，用 rAF 合帧后每帧至多
 *    一次 appendAssistantDelta（即每帧至多一次 version++），避免高频 delta 全树重渲卡顿；
 *    页面不可见 / 无 rAF 环境降级为 setTimeout(50ms)。finish/error/abort 前强制 flush 残余。
 *  - 归属校验（isOwner）：所有对目标消息的写入都要求「inflight 仍指向本次 controller」，
 *    使 retry（先 abort 旧流、复位、再起新流）时，旧流的残余 delta / 收尾不会误写新流的消息。
 *  - error chunk 的容错语义：实测 /api/chat 的流中会夹杂零星「瞬时」error chunk
 *    （疑似 MiniMax 个别 chunk 经 @ai-sdk/openai-compatible 解析失败，被
 *    toUIMessageStreamResponse 掩码为 "An error occurred." 后发出），之后正文
 *    text-delta / Markdown Artifact 继续到达并正常 finish。因此 onError 不立即判死：只记录 lastError
 *    （后到覆盖先到）并继续收流；终态统一裁决——收到过任何正文即按成功 finish
 *    （瞬时 error 忽略并 console.warn 留痕），正文/Artifact 都没有且有 error 用 lastError
 *    fail，两者都没有且无 error 也 fail。中止时即使已有部分输出也落为 error，
 *    避免未完成消息暴露复制和评价操作；用户可通过错误态的重试入口重新生成。
 */

import type { ThreadStore } from "../core/store"
import { buildRequestBody } from "./prompt"
import { consumeUIMessageStream } from "./ui-stream"
import type { MessageFeedback, MessageFeedbackSummary } from "../core/types"
import { prepareRegenerationPatch } from "../core/regeneration"
import { GENERATION_ERRORS } from "@/constants/generation"
import { getKnownTreeRevision, setKnownTreeRevision } from "./persist"
import { activeLeafTurn } from "../core/message-graph"
import { submitMessageFeedback } from "./message-feedback-command"
import { switchActiveLeaf } from "./switch-active-leaf-command"
import { requestGenerationStop } from "./stop-generation-command"
import { requestChatGeneration } from "./chat-generation-command"
import {
  ABORTED_ERROR,
  createAssistantStreamRuntime,
} from "./assistant-stream-runtime"
import {
  prepareAssistantRetry,
  type PreparedRegenerationAction,
  type PreparedRegenerationStart,
} from "./regeneration-command"
import type {
  GenerationActionResult,
  VariantSwitchResult,
} from "./message-action-results"

export type {
  GenerationActionResult,
  MessageActionFailureCode,
  VariantSwitchResult,
} from "./message-action-results"

/** 网络异常（非中止）的兜底错误文案 */
const NETWORK_ERROR = "网络请求失败，请重试"

export interface ThreadMessageActionCommands {
  retryAssistant(
    threadId: string,
    assistantMessageId: string
  ): Promise<GenerationActionResult>
  retryUserTurn(
    threadId: string,
    userMessageId: string
  ): Promise<GenerationActionResult>
  editAndRegenerate(
    threadId: string,
    userMessageId: string,
    text: string
  ): Promise<GenerationActionResult>
  switchTurnVariant(
    threadId: string,
    assistantMessageId: string
  ): Promise<VariantSwitchResult>
  submitFeedback(
    threadId: string,
    messageId: string,
    feedback: MessageFeedback | null
  ): Promise<MessageFeedbackSummary | null>
}

export type ChatController = ReturnType<typeof createChatController> &
  ThreadMessageActionCommands

/** 判断是否为「中止」类异常 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "AbortError"
  )
}

export interface ChatControllerOptions {
  treeId: string
  /** 严格整树存盘：失败必须 reject，确保不会调用付费模型。 */
  persistNow(): Promise<void>
  onError?(message: string): void
}

export function createChatController(
  store: ThreadStore,
  options: ChatControllerOptions
) {
  /** 每个会话同一时间只允许一路在飞的流式请求 */
  const inflight = new Map<string, AbortController>()

  /**
   * 对某会话的某条 assistant 消息发起真实流式请求。
   * 普通发送已由 beginAssistantMessage 备好目标；变体操作在服务端接受后原子应用 patch。
   */
  function startAssistant(
    threadId: string,
    msgId: string,
    userMessageId: string,
    generationId: string,
    action?: PreparedRegenerationAction
  ): Promise<GenerationActionResult> {
    const controller = new AbortController()
    inflight.set(threadId, controller)
    const { signal } = controller

    /** 本次流是否仍是该会话的当前在飞流（retry 会用新 controller 顶替旧的） */
    const isOwner = () => inflight.get(threadId) === controller

    const streamRuntime = createAssistantStreamRuntime({
      store,
      threadId,
      messageId: msgId,
      isOwner,
    })

    let streamHandedOff = false
    return (async () => {
      try {
        if (!action) {
          try {
            await options.persistNow()
          } catch (error) {
            console.error("[thread-chat] 发送前持久化屏障失败", error)
            streamRuntime.fail(GENERATION_ERRORS.persistenceBarrier)
            return {
              ok: false,
              code: "persistence_failed",
              message: GENERATION_ERRORS.persistenceBarrier,
            }
          }
        }
        if (signal.aborted)
          return { ok: false, code: "network_error", message: ABORTED_ERROR }

        const state = store.getState()
        const thread = state.threads[threadId]
        if (!thread) {
          streamRuntime.fail("会话不存在")
          return { ok: false, code: "not_found", message: "会话不存在" }
        }

        const body = buildRequestBody(state, thread, msgId, {
          treeId: options.treeId,
          userMessageId,
          generationId,
          intent: action?.intent ?? { kind: "persisted-turn" },
        })
        const command = await requestChatGeneration({ body, signal })
        if (command.kind === "replayed") {
          // 同 generation 请求重放：服务端已在执行或已终态，不启动第二次模型；
          // 保留 pending，由 generation 轮询取得权威状态。
          if (action) store.applyPreparedTurn(action.patch)
          return {
            ok: true,
            generationId,
            userMessageId,
            assistantMessageId: msgId,
            ...(action?.sourceUserMessageId
              ? { sourceUserMessageId: action.sourceUserMessageId }
              : {}),
            ...(action?.sourceAssistantMessageId
              ? { sourceAssistantMessageId: action.sourceAssistantMessageId }
              : {}),
          }
        }
        if (command.kind === "rejected") {
          if (!action) streamRuntime.fail(command.failure.message)
          return command.failure
        }
        const res = command.response
        if (command.revision !== null)
          setKnownTreeRevision(options.treeId, command.revision)
        if (action && !store.applyPreparedTurn(action.patch)) {
          return {
            ok: false,
            code: "generation_conflict",
            message: "服务端已接受生成，但本地消息图需要刷新",
          }
        }

        const accepted: GenerationActionResult = {
          ok: true,
          generationId,
          userMessageId,
          assistantMessageId: msgId,
          ...(action?.sourceUserMessageId
            ? { sourceUserMessageId: action.sourceUserMessageId }
            : {}),
          ...(action?.sourceAssistantMessageId
            ? { sourceAssistantMessageId: action.sourceAssistantMessageId }
            : {}),
        }

        if (action) {
          streamHandedOff = true
          void (async () => {
            try {
              await consumeUIMessageStream(res, streamRuntime.handlers, signal)
              if (signal.aborted) streamRuntime.settleByAbort()
              else streamRuntime.settleByOutcome()
            } catch (error) {
              if (signal.aborted || isAbortError(error))
                streamRuntime.settleByAbort()
              else streamRuntime.fail(NETWORK_ERROR)
            } finally {
              streamRuntime.cancel()
              if (inflight.get(threadId) === controller)
                inflight.delete(threadId)
            }
          })()
          return accepted
        }

        await consumeUIMessageStream(res, streamRuntime.handlers, signal)
        if (signal.aborted) {
          // 被 abort：consume 静默返回、onFinish 不触发——有正文保留 finish，零正文标可重试错误
          streamRuntime.settleByAbort()
        } else {
          // 正常结束时 handlers.onFinish 已 settle（幂等）；这里兜底走同一套终态裁决
          streamRuntime.settleByOutcome()
        }
        return accepted
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          streamRuntime.settleByAbort() // 中止：有正文保留 finish，零正文标可重试错误
        } else {
          if (!action) streamRuntime.fail(NETWORK_ERROR) // fetch reject 等
        }
        return {
          ok: false,
          code: "network_error",
          message: isAbortError(err) ? ABORTED_ERROR : NETWORK_ERROR,
        }
      } finally {
        if (!streamHandedOff) {
          streamRuntime.cancel()
          // 仅当 inflight 仍指向本次 controller 时才清除，避免 retry 竞态误删新流的条目
          if (inflight.get(threadId) === controller) inflight.delete(threadId)
        }
      }
    })()
  }

  /** 只断开本地 fetch 消费者；不会向服务端表达 Stop。 */
  function detachThread(threadId: string): void {
    inflight.get(threadId)?.abort()
  }

  function startPreparedRegeneration(start: PreparedRegenerationStart) {
    detachThread(start.threadId)
    return startAssistant(
      start.threadId,
      start.messageId,
      start.userMessageId,
      start.generationId,
      start.action
    )
  }

  function activeAssistant(threadId: string) {
    const thread = store.getState().threads[threadId]
    if (!thread) return null
    const turn = activeLeafTurn(thread)
    const message = turn?.assistantMessage
    if (
      !message ||
      (message.status !== "pending" && message.status !== "streaming")
    )
      return null
    return { message, index: thread.messages.indexOf(message) }
  }

  async function requestStop(threadId: string): Promise<boolean> {
    const active = activeAssistant(threadId)
    const generationId = active?.message.generationId
    if (!generationId) return false
    const result = await requestGenerationStop(generationId)
    if (!result.ok) {
      options.onError?.(result.message)
      return false
    }
    detachThread(threadId)
    return true
  }

  return {
    /** 在会话里发一条用户消息并触发流式回复；同会话已有在飞请求时直接忽略 */
    send(threadId: string, text: string, quote?: { text: string }): void {
      if (inflight.has(threadId) || activeAssistant(threadId)) return
      const userMessageId = store.appendUserMessage(threadId, text, quote)
      if (!userMessageId) return
      const generationId = crypto.randomUUID()
      const msgId = store.beginAssistantMessage(threadId, generationId)
      if (!msgId) return
      void startAssistant(threadId, msgId, userMessageId, generationId)
    },

    /** 兼容旧宿主的 retry 入口；新语义为追加 sibling assistant。 */
    retry(threadId: string, msgId: string): void {
      const prepared = prepareAssistantRetry(store.getState(), {
        threadId,
        sourceAssistantMessageId: msgId,
        assistantMessageId: crypto.randomUUID(),
        generationId: crypto.randomUUID(),
      })
      if (!prepared.ok) return
      void startPreparedRegeneration(prepared.start)
    },

    async retryAssistant(
      threadId: string,
      assistantMessageId: string
    ): Promise<GenerationActionResult> {
      const prepared = prepareAssistantRetry(store.getState(), {
        threadId,
        sourceAssistantMessageId: assistantMessageId,
        assistantMessageId: crypto.randomUUID(),
        generationId: crypto.randomUUID(),
      })
      if (!prepared.ok) return prepared
      return startPreparedRegeneration(prepared.start)
    },

    async retryUserTurn(
      threadId: string,
      userMessageId: string
    ): Promise<GenerationActionResult> {
      const generationId = crypto.randomUUID()
      const assistantMessageId = crypto.randomUUID()
      const patch = prepareRegenerationPatch(store.getState(), {
        threadId,
        userMessageId,
        assistantMessageId,
        generationId,
        intent: { kind: "retry-orphan-user" },
      })
      if (!patch)
        return {
          ok: false,
          code: "not_latest_turn",
          message: "该消息已不是可恢复的最后一轮",
        }
      detachThread(threadId)
      return startAssistant(
        threadId,
        assistantMessageId,
        userMessageId,
        generationId,
        {
          intent: { kind: "retry-orphan-user" },
          patch,
          sourceUserMessageId: userMessageId,
        }
      )
    },

    async editAndRegenerate(
      threadId: string,
      userMessageId: string,
      text: string
    ): Promise<GenerationActionResult> {
      const generationId = crypto.randomUUID()
      const nextUserMessageId = crypto.randomUUID()
      const assistantMessageId = crypto.randomUUID()
      const intent = {
        kind: "edit-last-user" as const,
        sourceUserMessageId: userMessageId,
        text,
      }
      const patch = prepareRegenerationPatch(store.getState(), {
        threadId,
        userMessageId: nextUserMessageId,
        assistantMessageId,
        generationId,
        intent,
      })
      if (!patch)
        return {
          ok: false,
          code: "not_latest_turn",
          message: "只能编辑当前最后一轮用户消息",
        }
      detachThread(threadId)
      return startAssistant(
        threadId,
        assistantMessageId,
        nextUserMessageId,
        generationId,
        { intent, patch, sourceUserMessageId: userMessageId }
      )
    },

    async switchTurnVariant(
      threadId: string,
      assistantMessageId: string
    ): Promise<VariantSwitchResult> {
      const result = await switchActiveLeaf({
        treeId: options.treeId,
        threadId,
        assistantMessageId,
        baseRevision: getKnownTreeRevision(options.treeId),
      })
      if (!result.ok) return result
      setKnownTreeRevision(options.treeId, result.revision)
      if (!store.setActiveLeaf(threadId, assistantMessageId))
        return {
          ok: false,
          code: "generation_conflict",
          message: "本地消息图需要刷新",
        }
      return result
    },

    async submitFeedback(
      threadId: string,
      messageId: string,
      feedback: MessageFeedback | null
    ): Promise<MessageFeedbackSummary | null> {
      return submitMessageFeedback({
        treeId: options.treeId,
        threadId,
        messageId,
        feedback,
      })
    },

    /** 只有该显式操作才请求服务端停止模型；服务端确认后再断开本地流。 */
    stop(threadId: string): void {
      void requestStop(threadId)
    },

    /** 页面卸载只 detach 本地消费者，服务端 generation 继续执行与计费。 */
    detachAll(): void {
      inflight.forEach((c) => c.abort())
    },
  }
}
