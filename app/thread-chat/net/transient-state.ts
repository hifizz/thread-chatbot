import type { Message, Thread, ThreadTreeState } from "../core/types"
import { persistableWebSearchState } from "./web-search-persistence.ts"

/**
 * 防止 Markdown 半成品与进行中的 Web Search 活动态进入 branch_trees.state。
 * 已结束的搜索聚合卡及其流顺序位置随消息持久化；正常完成态保持原对象，
 * 避免每次存盘无意义复制整棵树。
 */
export function withoutTransientGenerationState(
  state: ThreadTreeState
): ThreadTreeState {
  let stateChanged = false
  const threads: Record<string, Thread> = {}

  for (const [threadId, thread] of Object.entries(state.threads)) {
    let threadChanged = false
    const messages: Message[] = thread.messages.map((message) => {
      const searchState = persistableWebSearchState(message)
      if (
        message.markdownGeneration === undefined &&
        searchState.activities === message.webSearchActivities &&
        searchState.textOffset === message.webSearchActivityTextOffset
      )
        return message
      threadChanged = true
      const persisted = { ...message }
      delete persisted.markdownGeneration
      if (searchState.activities) {
        persisted.webSearchActivities = searchState.activities
      } else {
        delete persisted.webSearchActivities
      }
      if (searchState.textOffset !== undefined) {
        persisted.webSearchActivityTextOffset = searchState.textOffset
      } else {
        delete persisted.webSearchActivityTextOffset
      }
      return persisted
    })
    threads[threadId] = threadChanged ? { ...thread, messages } : thread
    stateChanged ||= threadChanged
  }

  return stateChanged ? { ...state, threads } : state
}
