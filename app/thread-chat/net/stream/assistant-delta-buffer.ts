import type { ThreadStore } from "../../core/store"

/** 页面不可见 / 无 requestAnimationFrame 时的降级刷新间隔（毫秒）。 */
const FALLBACK_FLUSH_MS = 50

type AssistantDeltaBufferInput = {
  store: ThreadStore
  threadId: string
  messageId: string
  isOwner(): boolean
}

/** 将高频正文 delta 与 Markdown 进度合并为每帧至多一次 store 更新。 */
export function createAssistantDeltaBuffer({
  store,
  threadId,
  messageId,
  isOwner,
}: AssistantDeltaBufferInput) {
  let pendingText = ""
  let pendingMarkdownProgress:
    Parameters<ThreadStore["setMarkdownGenerationProgress"]>[2] | null = null
  let frame: number | null = null
  let usingAnimationFrame = false

  const flush = () => {
    if (!pendingText && !pendingMarkdownProgress) return
    if (!isOwner()) {
      pendingText = ""
      pendingMarkdownProgress = null
      return
    }
    if (pendingText) {
      const delta = pendingText
      pendingText = ""
      store.appendAssistantDelta(threadId, messageId, delta)
    }
    if (pendingMarkdownProgress) {
      const progress = pendingMarkdownProgress
      pendingMarkdownProgress = null
      store.setMarkdownGenerationProgress(threadId, messageId, progress)
    }
  }

  const onFrame = () => {
    frame = null
    flush()
  }
  const canUseAnimationFrame = () =>
    typeof requestAnimationFrame !== "undefined" &&
    !(typeof document !== "undefined" && document.hidden)
  const schedule = () => {
    if (frame !== null) return
    if (canUseAnimationFrame()) {
      usingAnimationFrame = true
      frame = requestAnimationFrame(onFrame)
    } else {
      usingAnimationFrame = false
      frame = setTimeout(onFrame, FALLBACK_FLUSH_MS) as unknown as number
    }
  }

  return {
    appendText(delta: string) {
      pendingText += delta
      schedule()
    },

    setMarkdownProgress(
      progress: Parameters<ThreadStore["setMarkdownGenerationProgress"]>[2]
    ) {
      if (progress.phase === "starting") {
        pendingMarkdownProgress = null
        store.setMarkdownGenerationProgress(threadId, messageId, progress)
        return
      }
      pendingMarkdownProgress = progress
      schedule()
    },

    clearMarkdownProgress() {
      pendingMarkdownProgress = null
    },

    flush,

    cancel() {
      if (frame === null) return
      if (usingAnimationFrame) cancelAnimationFrame(frame)
      else clearTimeout(frame)
      frame = null
    },
  }
}
