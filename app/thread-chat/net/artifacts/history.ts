import type { ThreadChatClient } from "../client"
import type { ConversationStore } from "../../core/store"

/** 只为已打开的消息路径补齐历史卡片；当前目录与历史正文均不由这里修改。 */
export function startThreadArtifactHistory(projectId: string, client: ThreadChatClient, store: ConversationStore) {
  let disposed = false
  const loaded = new Map<string, string>()
  const running = new Set<string>()
  const isCurrent = () => !disposed && store.getState().project?.id === projectId

  function refresh() {
    if (!isCurrent()) return
    const state = store.getState()
    const visible = new Set([state.project?.rootThreadId, ...state.workspace.openThreadIds,
      state.workspace.selectedThreadId])
    if (state.workspace.view === "canvas") {
      for (const id of state.workspace.expandedNodes) visible.add(id)
    }
    for (const threadId of visible) {
      if (!threadId || !state.threadsById[threadId] || running.has(threadId)) continue
      const signature = (state.messageIdsByThread[threadId] ?? []).map((id) =>
        `${id}:${state.messagesById[id]?.status}`).join("|")
      if (loaded.get(threadId) === signature) continue
      running.add(threadId)
      void load(threadId, signature)
    }
  }

  async function load(threadId: string, signature: string) {
    let succeeded = false
    try {
      const artifacts = await client.listThreadArtifacts(threadId)
      if (!isCurrent()) return
      loaded.set(threadId, signature)
      store.getState().cacheArtifactSummaries(artifacts)
      succeeded = true
    } catch {
      // 下次目录刷新或重新打开 Thread 时重试，失败不伪装成已加载。
    } finally {
      running.delete(threadId)
      // 请求途中消息终态发生变化时再取一次；失败不会立即自旋。
      if (succeeded) refresh()
    }
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.workspace !== previous.workspace || state.messagesById !== previous.messagesById) refresh()
  })
  refresh()
  return { refresh, dispose() { disposed = true; unsubscribe() } }
}
