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
 *    text-delta 继续到达并正常 finish。因此 onError 不立即判死：只记录 lastError
 *    （后到覆盖先到）并继续收流；终态统一裁决——收到过任何正文即按成功 finish
 *    （瞬时 error 忽略并 console.warn 留痕），零正文且有 error 用 lastError fail，
 *    零正文且无 error 也 fail（「未收到任何回复」：空回复应可重试而非静默完成）。
 *  - 中止（停止按钮 / 卸载 / retry 顶替）：已有正文 → 保留文本 finish；
 *    零正文 → fail（「已停止生成」，可重试），不留空的 done 气泡。网络失败照旧 fail。
 */

import type { ThreadStore } from "../core/store"
import { buildRequestBody } from "./prompt"
import { consumeUIMessageStream, type UIStreamHandlers } from "./ui-stream"

/** 页面不可见 / 无 requestAnimationFrame 时的降级刷新间隔（毫秒） */
const FALLBACK_FLUSH_MS = 50
/** 网络异常（非中止）的兜底错误文案 */
const NETWORK_ERROR = "网络请求失败，请重试"
/** 流正常结束但一个正文字符都没收到时的错误文案（空回复转正为可重试错误） */
const EMPTY_REPLY_ERROR = "未收到任何回复，请重试"
/** 零正文时被中止（停止按钮 / 卸载）的错误文案 */
const ABORTED_ERROR = "已停止生成"

export type ChatController = ReturnType<typeof createChatController>

/** 判断是否为「中止」类异常 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "AbortError"
  )
}

export function createChatController(store: ThreadStore) {
  /** 每个会话同一时间只允许一路在飞的流式请求 */
  const inflight = new Map<string, AbortController>()

  /**
   * 对某会话的某条 assistant 消息发起真实流式请求。
   * 调用前必须已通过 beginAssistantMessage / resetAssistantMessage 备好目标消息。
   */
  function startAssistant(threadId: string, msgId: string): void {
    const controller = new AbortController()
    inflight.set(threadId, controller)
    const { signal } = controller

    /** 本次流是否仍是该会话的当前在飞流（retry 会用新 controller 顶替旧的） */
    const isOwner = () => inflight.get(threadId) === controller

    // ---- 合帧缓冲 ----
    let pending = ""
    let frame: number | null = null
    let usingRAF = false

    const doFlush = () => {
      if (!pending) return
      if (!isOwner()) {
        pending = "" // 已被新流顶替：丢弃残余，不写旧消息
        return
      }
      const delta = pending
      pending = ""
      store.appendAssistantDelta(threadId, msgId, delta)
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

    /** 流「正常走完」时的终态裁决：有正文即成功；零正文一律 fail（可重试） */
    const settleByOutcome = () => {
      settle(() => {
        if (receivedChars > 0) {
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

    /** 中止时的终态裁决：已有正文保留文本 finish；零正文 fail（可重试） */
    const settleByAbort = () => {
      settle(() => {
        if (receivedChars > 0) store.finishAssistantMessage(threadId, msgId)
        else store.failAssistantMessage(threadId, msgId, ABORTED_ERROR)
      })
    }

    const handlers: UIStreamHandlers = {
      onTextDelta(delta) {
        if (settled) return
        receivedChars += delta.length
        pending += delta
        schedule()
      },
      onError(message) {
        if (settled) return
        lastError = message // 不立即 settle：可能是瞬时噪声，正文还会继续到达（后到覆盖先到）
      },
      onFinish() {
        settleByOutcome()
      },
    }

    void (async () => {
      try {
        const state = store.getState()
        const thread = state.threads[threadId]
        if (!thread) {
          settle(() =>
            store.failAssistantMessage(threadId, msgId, "会话不存在")
          )
          return
        }

        const body = buildRequestBody(state, thread, msgId)
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        })

        if (!res.ok || !res.body) {
          settle(() =>
            store.failAssistantMessage(
              threadId,
              msgId,
              `请求失败（HTTP ${res.status}）`
            )
          )
          return
        }

        await consumeUIMessageStream(res, handlers, signal)
        if (signal.aborted) {
          // 被 abort：consume 静默返回、onFinish 不触发——有正文保留 finish，零正文标可重试错误
          settleByAbort()
        } else {
          // 正常结束时 handlers.onFinish 已 settle（幂等）；这里兜底走同一套终态裁决
          settleByOutcome()
        }
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          settleByAbort() // 中止：有正文保留 finish，零正文标可重试错误
        } else {
          settle(() =>
            store.failAssistantMessage(threadId, msgId, NETWORK_ERROR)
          ) // fetch reject 等
        }
      } finally {
        cancelFrame()
        // 仅当 inflight 仍指向本次 controller 时才清除，避免 retry 竞态误删新流的条目
        if (inflight.get(threadId) === controller) inflight.delete(threadId)
      }
    })()
  }

  /** 中止某会话在飞的流式请求（不从 inflight 删除：交由该流的 finally 收尾；
      有正文保留 finish，零正文标「已停止生成」可重试） */
  function abortThread(threadId: string): void {
    inflight.get(threadId)?.abort()
  }

  return {
    /** 在会话里发一条用户消息并触发流式回复；同会话已有在飞请求时直接忽略 */
    send(threadId: string, text: string): void {
      if (inflight.has(threadId)) return
      if (!store.appendUserMessage(threadId, text)) return
      const msgId = store.beginAssistantMessage(threadId)
      if (!msgId) return
      startAssistant(threadId, msgId)
    },

    /** 重试：先中止在飞的旧流，复位同一条消息（清空正文/错误、回到 pending），再起新流复用该 msgId */
    retry(threadId: string, msgId: string): void {
      abortThread(threadId)
      store.resetAssistantMessage(threadId, msgId)
      startAssistant(threadId, msgId)
    },

    /** 中止某会话在飞的流式请求（有正文保留 finish；零正文标「已停止生成」可重试） */
    abort(threadId: string): void {
      abortThread(threadId)
    },

    /** 中止所有会话在飞的流式请求（壳层卸载时调用） */
    abortAll(): void {
      inflight.forEach((c) => c.abort())
    },
  }
}
