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
import { consumeUIMessageStream, type UIStreamHandlers } from "./ui-stream"
import { handleUnauthorized } from "@/lib/auth/session-recovery"
import type {
  ArtifactSeed,
  MessageFeedback,
  MessageFeedbackSummary,
} from "../core/types"
import {
  prepareRegenerationPatch,
  type PreparedTurnPatch,
} from "../core/regeneration"
import { hasAssistantOutput } from "./assistant-output"
import { GENERATION_ERRORS } from "@/constants/generation"
import type { ThreadChatGenerationIntent } from "../generation/types"
import { getKnownTreeRevision, setKnownTreeRevision } from "./persist"
import { activeLeafTurn } from "../core/message-graph"
import { submitMessageFeedback } from "./message-feedback-command"
import { switchActiveLeaf } from "./switch-active-leaf-command"
import { requestGenerationStop } from "./stop-generation-command"
import type {
  GenerationActionResult,
  MessageActionFailureCode,
  VariantSwitchResult,
} from "./message-action-results"

export type {
  GenerationActionResult,
  MessageActionFailureCode,
  VariantSwitchResult,
} from "./message-action-results"

/** 页面不可见 / 无 requestAnimationFrame 时的降级刷新间隔（毫秒） */
const FALLBACK_FLUSH_MS = 50
/** 网络异常（非中止）的兜底错误文案 */
const NETWORK_ERROR = "网络请求失败，请重试"
/** 流正常结束但一个正文字符都没收到时的错误文案（空回复转正为可重试错误） */
const EMPTY_REPLY_ERROR = "未收到任何回复，请重试"
/** 零正文时被中止（停止按钮 / 卸载）的错误文案 */
const ABORTED_ERROR = "已停止生成"

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
    action?: {
      intent: Exclude<ThreadChatGenerationIntent, { kind: "persisted-turn" }>
      patch: PreparedTurnPatch
      sourceUserMessageId?: string
      sourceAssistantMessageId?: string
    }
  ): Promise<GenerationActionResult> {
    const controller = new AbortController()
    inflight.set(threadId, controller)
    const { signal } = controller

    /** 本次流是否仍是该会话的当前在飞流（retry 会用新 controller 顶替旧的） */
    const isOwner = () => inflight.get(threadId) === controller

    // ---- 合帧缓冲 ----
    let pending = ""
    let pendingMarkdownProgress:
      Parameters<ThreadStore["setMarkdownGenerationProgress"]>[2] | null = null
    let frame: number | null = null
    let usingRAF = false

    const doFlush = () => {
      if (!pending && !pendingMarkdownProgress) return
      if (!isOwner()) {
        pending = "" // 已被新流顶替：丢弃残余，不写旧消息
        pendingMarkdownProgress = null
        return
      }
      if (pending) {
        const delta = pending
        pending = ""
        store.appendAssistantDelta(threadId, msgId, delta)
      }
      if (pendingMarkdownProgress) {
        const progress = pendingMarkdownProgress
        pendingMarkdownProgress = null
        store.setMarkdownGenerationProgress(threadId, msgId, progress)
      }
    }
    const onFrame = () => {
      frame = null
      doFlush()
    }
    const canUseRAF = () =>
      typeof requestAnimationFrame !== "undefined" &&
      !(typeof document !== "undefined" && document.hidden)
    const schedule = () => {
      if (frame !== null) return
      if (canUseRAF()) {
        usingRAF = true
        frame = requestAnimationFrame(onFrame)
      } else {
        usingRAF = false
        frame = setTimeout(onFrame, FALLBACK_FLUSH_MS) as unknown as number
      }
    }
    const cancelFrame = () => {
      if (frame === null) return
      if (usingRAF) cancelAnimationFrame(frame)
      else clearTimeout(frame)
      frame = null
    }

    // ---- 终态收敛（只结算一次；非归属者只清理不写消息）----
    let settled = false
    const settle = (apply: () => void) => {
      if (settled) return
      settled = true
      cancelFrame()
      if (!isOwner()) return // 已被 retry 顶替：不触碰新流的消息
      doFlush() // 先 flush 残余文本，再落终态
      apply()
    }

    // ---- error chunk 容错：只记录不判死，终态统一裁决（见文件头说明）----
    let lastError: string | null = null
    /** 本次流累计收到的正文字符数（含尚在 pending 缓冲里的） */
    let receivedChars = 0
    /** 已成功原子绑定到目标消息的 Artifact 数 */
    let attachedArtifactCount = 0
    const hasOutput = () =>
      hasAssistantOutput({
        receivedTextChars: receivedChars,
        attachedArtifactCount,
      })

    /** 流「正常走完」时的终态裁决：有正文即成功；零正文一律 fail（可重试） */
    const settleByOutcome = () => {
      settle(() => {
        if (hasOutput()) {
          if (lastError !== null)
            console.warn(
              "[thread-chat] 流中出现瞬时 error chunk（已忽略）:",
              lastError
            )
          store.finishAssistantMessage(threadId, msgId)
        } else if (lastError !== null) {
          store.failAssistantMessage(threadId, msgId, lastError)
        } else {
          // 空回复转正为错误：可点「重试」，而不是留一个静默完成的空气泡
          store.failAssistantMessage(threadId, msgId, EMPTY_REPLY_ERROR)
        }
      })
    }

    /** 中止时即使已有部分正文也保持 error，避免把不完整回复开放为可评价终态。 */
    const settleByAbort = () => {
      settle(() => store.failAssistantMessage(threadId, msgId, ABORTED_ERROR))
    }

    const handlers: UIStreamHandlers = {
      onTextDelta(delta) {
        if (settled) return
        receivedChars += delta.replace(/\s/g, "").length
        pending += delta
        schedule()
      },
      onMarkdownArtifactProgress(event) {
        if (settled || !isOwner()) return
        if (event.phase === "starting") {
          pendingMarkdownProgress = null
          store.setMarkdownGenerationProgress(threadId, msgId, event)
          return
        }
        pendingMarkdownProgress = event
        schedule()
      },
      onMarkdownArtifact(event) {
        if (settled || !isOwner()) return
        pendingMarkdownProgress = null
        const seed: ArtifactSeed = {
          kind: "markdown",
          title: event.input.title,
          content: event.input.content,
        }
        if (store.attachArtifactToMessage(threadId, msgId, seed) !== null)
          attachedArtifactCount++
      },
      onWebResearchActivity(activity) {
        if (settled || !isOwner()) return
        // UI 必须把聚合面板插在 tool-input-start 的真实位置。先把此前按帧
        // 缓冲的 text-delta 落进消息，store 才能记录准确的正文字符偏移。
        doFlush()
        store.setWebResearchActivity(threadId, msgId, activity)
      },
      onResearchRoute(route) {
        if (settled || !isOwner()) return
        store.setResearchRoute(threadId, msgId, route)
      },
      onResearchPlan(plan) {
        if (settled || !isOwner()) return
        store.setResearchPlan(threadId, msgId, plan)
      },
      onError(message) {
        if (settled) return
        lastError = message // 不立即 settle：可能是瞬时噪声，正文还会继续到达（后到覆盖先到）
      },
      onFinish() {
        settleByOutcome()
      },
    }

    let streamHandedOff = false
    return (async () => {
      try {
        if (!action) {
          try {
            await options.persistNow()
          } catch (error) {
            console.error("[thread-chat] 发送前持久化屏障失败", error)
            settle(() =>
              store.failAssistantMessage(
                threadId,
                msgId,
                GENERATION_ERRORS.persistenceBarrier
              )
            )
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
          settle(() =>
            store.failAssistantMessage(threadId, msgId, "会话不存在")
          )
          return { ok: false, code: "not_found", message: "会话不存在" }
        }

        const body = buildRequestBody(state, thread, msgId, {
          treeId: options.treeId,
          userMessageId,
          generationId,
          intent: action?.intent ?? { kind: "persisted-turn" },
        })
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        })

        if (res.status === 202) {
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
        if (!res.ok || !res.body) {
          // 401：会话已失效——触发自救（登出 + 跳登录），并给出明确文案而非死胡同错误
          if (res.status === 401) void handleUnauthorized()
          const payload = (await res.json().catch(() => null)) as {
            error?: { code?: MessageActionFailureCode; message?: string }
          } | null
          const message =
            res.status === 401
              ? "登录已失效，正在跳转登录…"
              : (payload?.error?.message ?? `请求失败（HTTP ${res.status}）`)
          if (!action)
            settle(() => store.failAssistantMessage(threadId, msgId, message))
          return {
            ok: false,
            code:
              res.status === 401
                ? "unauthorized"
                : (payload?.error?.code ?? "network_error"),
            message,
          }
        }

        const revision = Number(res.headers.get("x-thread-tree-revision"))
        if (Number.isInteger(revision))
          setKnownTreeRevision(options.treeId, revision)
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
              await consumeUIMessageStream(res, handlers, signal)
              if (signal.aborted) settleByAbort()
              else settleByOutcome()
            } catch (error) {
              if (signal.aborted || isAbortError(error)) settleByAbort()
              else
                settle(() =>
                  store.failAssistantMessage(threadId, msgId, NETWORK_ERROR)
                )
            } finally {
              cancelFrame()
              if (inflight.get(threadId) === controller)
                inflight.delete(threadId)
            }
          })()
          return accepted
        }

        await consumeUIMessageStream(res, handlers, signal)
        if (signal.aborted) {
          // 被 abort：consume 静默返回、onFinish 不触发——有正文保留 finish，零正文标可重试错误
          settleByAbort()
        } else {
          // 正常结束时 handlers.onFinish 已 settle（幂等）；这里兜底走同一套终态裁决
          settleByOutcome()
        }
        return accepted
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          settleByAbort() // 中止：有正文保留 finish，零正文标可重试错误
        } else {
          if (!action)
            settle(() =>
              store.failAssistantMessage(threadId, msgId, NETWORK_ERROR)
            ) // fetch reject 等
        }
        return {
          ok: false,
          code: "network_error",
          message: isAbortError(err) ? ABORTED_ERROR : NETWORK_ERROR,
        }
      } finally {
        if (!streamHandedOff) {
          cancelFrame()
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
      const generationId = crypto.randomUUID()
      const nextAssistantMessageId = crypto.randomUUID()
      const source = store
        .getState()
        .threads[threadId]?.messages.find((message) => message.id === msgId)
      if (source?.role !== "assistant" || !source.parentMessageId) return
      const patch = prepareRegenerationPatch(store.getState(), {
        threadId,
        userMessageId: source.parentMessageId,
        assistantMessageId: nextAssistantMessageId,
        generationId,
        intent: {
          kind: "regenerate-assistant",
          sourceAssistantMessageId: msgId,
        },
      })
      if (!patch) return
      detachThread(threadId)
      void startAssistant(
        threadId,
        nextAssistantMessageId,
        source.parentMessageId,
        generationId,
        {
          intent: {
            kind: "regenerate-assistant",
            sourceAssistantMessageId: msgId,
          },
          patch,
          sourceAssistantMessageId: msgId,
        }
      )
    },

    async retryAssistant(
      threadId: string,
      assistantMessageId: string
    ): Promise<GenerationActionResult> {
      const generationId = crypto.randomUUID()
      const nextAssistantMessageId = crypto.randomUUID()
      const thread = store.getState().threads[threadId]
      const source = thread?.messages.find(
        (message) => message.id === assistantMessageId
      )
      if (!thread || source?.role !== "assistant" || !source.parentMessageId)
        return { ok: false, code: "not_found", message: "回复不存在" }
      const patch = prepareRegenerationPatch(store.getState(), {
        threadId,
        userMessageId: source.parentMessageId,
        assistantMessageId: nextAssistantMessageId,
        generationId,
        intent: {
          kind: "regenerate-assistant",
          sourceAssistantMessageId: assistantMessageId,
        },
      })
      if (!patch)
        return {
          ok: false,
          code: "not_latest_turn",
          message: "只能重新生成当前最后一轮回复",
        }
      detachThread(threadId)
      return startAssistant(
        threadId,
        nextAssistantMessageId,
        source.parentMessageId,
        generationId,
        {
          intent: {
            kind: "regenerate-assistant",
            sourceAssistantMessageId: assistantMessageId,
          },
          patch,
          sourceAssistantMessageId: assistantMessageId,
        }
      )
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
