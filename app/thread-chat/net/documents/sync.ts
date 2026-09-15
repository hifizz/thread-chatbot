import { DOCUMENT_PROGRESS_REFRESH_MS } from "@/constants/project-documents"
import type { ThreadChatClient } from "../client"
import type { ConversationStore } from "../../core/store"

/** 项目运行时持有同步生命周期；目录与新正文一次写入，历史正文不变。 */
export function startProjectDocumentSync(projectId: string, client: ThreadChatClient, store: ConversationStore) {
  let disposed = false
  let running = false
  const refresh = async () => {
    if (disposed || running) return
    running = true
    try {
      const { documents, artifacts } = await client.listDocuments(projectId)
      if (disposed) return
      if (disposed || store.getState().project?.id !== projectId) return
      store.getState().syncDocuments(documents, artifacts)
      store.getState().setDocumentSyncError(false)
    } catch {
      if (!disposed) store.getState().setDocumentSyncError(true)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void refresh(), DOCUMENT_PROGRESS_REFRESH_MS)
  void refresh()
  return { refresh, dispose() { disposed = true; clearInterval(timer) } }
}
