import type { ThreadStore } from "../core/store"
import type { ArtifactSeed } from "../core/types"
import { hasAssistantOutput } from "./assistant-output"
import { createAssistantDeltaBuffer } from "./assistant-delta-buffer"
import type { UIStreamHandlers } from "./ui-stream"

/** 流正常结束但正文和 Artifact 都为空时的可重试错误。 */
const EMPTY_REPLY_ERROR = "未收到任何回复，请重试"
/** 用户停止或本地 detach 后统一使用的错误终态。 */
export const ABORTED_ERROR = "已停止生成"

type AssistantStreamRuntimeInput = {
  store: ThreadStore
  threadId: string
  messageId: string
  isOwner(): boolean
}

/** 组合 delta buffer、SSE handlers 与一次性终态裁决。 */
export function createAssistantStreamRuntime({
  store,
  threadId,
  messageId,
  isOwner,
}: AssistantStreamRuntimeInput) {
  const deltaBuffer = createAssistantDeltaBuffer({
    store,
    threadId,
    messageId,
    isOwner,
  })
  let settled = false
  let lastError: string | null = null
  let receivedChars = 0
  let attachedArtifactCount = 0

  const settle = (apply: () => void) => {
    if (settled) return
    settled = true
    deltaBuffer.cancel()
    if (!isOwner()) return
    deltaBuffer.flush()
    apply()
  }

  const settleByOutcome = () => {
    settle(() => {
      if (
        hasAssistantOutput({
          receivedTextChars: receivedChars,
          attachedArtifactCount,
        })
      ) {
        if (lastError !== null) {
          console.warn(
            "[thread-chat] 流中出现瞬时 error chunk（已忽略）:",
            lastError
          )
        }
        store.finishAssistantMessage(threadId, messageId)
      } else if (lastError !== null) {
        store.failAssistantMessage(threadId, messageId, lastError)
      } else {
        store.failAssistantMessage(threadId, messageId, EMPTY_REPLY_ERROR)
      }
    })
  }

  const settleByAbort = () => {
    settle(() => store.failAssistantMessage(threadId, messageId, ABORTED_ERROR))
  }

  const handlers: UIStreamHandlers = {
    onTextDelta(delta) {
      if (settled) return
      receivedChars += delta.replace(/\s/g, "").length
      deltaBuffer.appendText(delta)
    },
    onMarkdownArtifactProgress(event) {
      if (settled || !isOwner()) return
      deltaBuffer.setMarkdownProgress(event)
    },
    onMarkdownArtifact(event) {
      if (settled || !isOwner()) return
      deltaBuffer.clearMarkdownProgress()
      const seed: ArtifactSeed = {
        kind: "markdown",
        title: event.input.title,
        content: event.input.content,
      }
      if (store.attachArtifactToMessage(threadId, messageId, seed) !== null) {
        attachedArtifactCount++
      }
    },
    onWebResearchActivity(activity) {
      if (settled || !isOwner()) return
      deltaBuffer.flush()
      store.setWebResearchActivity(threadId, messageId, activity)
    },
    onResearchRoute(route) {
      if (settled || !isOwner()) return
      store.setResearchRoute(threadId, messageId, route)
    },
    onResearchPlan(plan) {
      if (settled || !isOwner()) return
      store.setResearchPlan(threadId, messageId, plan)
    },
    onError(message) {
      if (settled) return
      lastError = message
    },
    onFinish() {
      settleByOutcome()
    },
  }

  return {
    handlers,
    settleByOutcome,
    settleByAbort,
    fail(message: string) {
      settle(() => store.failAssistantMessage(threadId, messageId, message))
    },
    cancel() {
      deltaBuffer.cancel()
    },
  }
}
