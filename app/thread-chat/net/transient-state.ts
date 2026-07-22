import type { Message, Thread, ThreadTreeState } from "../core/types"

/**
 * 防止 Markdown 半成品进度进入 branch_trees.state。仅在确有临时字段时浅克隆，
 * 正常完成态保持原对象，避免每次存盘无意义复制整棵树。
 */
export function withoutTransientGenerationState(
  state: ThreadTreeState
): ThreadTreeState {
  let stateChanged = false
  const threads: Record<string, Thread> = {}

  for (const [threadId, thread] of Object.entries(state.threads)) {
    let threadChanged = false
    const messages: Message[] = thread.messages.map((message) => {
      if (message.markdownGeneration === undefined) return message
      threadChanged = true
      const persisted = { ...message }
      delete persisted.markdownGeneration
      return persisted
    })
    threads[threadId] = threadChanged ? { ...thread, messages } : thread
    stateChanged ||= threadChanged
  }

  return stateChanged ? { ...state, threads } : state
}
