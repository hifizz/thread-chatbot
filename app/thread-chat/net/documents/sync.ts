import { DOCUMENT_PROGRESS_REFRESH_MS } from "@/constants/project-documents"
import type { ThreadChatClient } from "../client"
import type { ConversationStore } from "../../core/store"

/** 唯一目录刷新入口；失效通知合并排队，丢弃通知之前发出的旧请求。 */
export function startProjectDocumentSync(projectId: string, client: ThreadChatClient, store: ConversationStore) {
  let disposed = false
  let pending = false
  let generation = 0
  let running: Promise<void> | null = null
  const isCurrent = () => !disposed && store.getState().project?.id === projectId

  async function drain() {
    while (pending && isCurrent()) {
      pending = false
      const requestedGeneration = generation
      try {
        const catalog = await client.listDocuments(projectId)
        if (!isCurrent() || requestedGeneration !== generation) continue
        store.getState().syncDocuments(catalog.documents, catalog.artifacts)
        store.getState().setDocumentSyncError(false)
      } catch {
        if (isCurrent() && requestedGeneration === generation) {
          store.getState().setDocumentSyncError(true)
        }
      }
    }
  }

  function refresh(): Promise<void> {
    if (!isCurrent()) return Promise.resolve()
    generation++
    pending = true
    if (!running) running = drain().finally(() => {
      running = null
      if (pending && isCurrent()) void refresh()
    })
    return running
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.documentRefreshRequested !== previous.documentRefreshRequested) void refresh()
  })
  // 轮询不使正在进行的请求失效，避免慢请求被每五秒永久饿死。
  const timer = setInterval(() => { if (!running) void refresh() }, DOCUMENT_PROGRESS_REFRESH_MS)
  void refresh()
  return { refresh, dispose() { disposed = true; unsubscribe(); clearInterval(timer) } }
}
