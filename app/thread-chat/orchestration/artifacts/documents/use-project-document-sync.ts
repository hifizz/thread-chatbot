"use client"
import { useEffect, useState } from "react"
import { DOCUMENT_PROGRESS_REFRESH_MS } from "@/constants/project-documents"
import type { ThreadChatClient } from "../../../net/client"
import type { ConversationStore } from "../../../core/store"

/** 刷新目录元数据，不切换正在阅读的版本或改动草稿。 */
export function useProjectDocumentSync({ projectId, client, store, enabled }: {
  projectId: string; client: ThreadChatClient; store: ConversationStore; enabled: boolean
}) {
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let active = true
    let running = false
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const result = await client.listDocuments(projectId)
        if (!active) return
        setError(false)
        // 只同步固定产物和 head 元数据，不改变 activeId、正文选区或问题草稿。
        const missing = result.documents.flatMap((doc) =>
          doc.currentArtifactId && !store.getState().artifactsById[doc.currentArtifactId]
            ? [doc.currentArtifactId] : [])
        const fetched = await Promise.all(missing.map((id) => client.getArtifact(id)))
        if (!active) return
        for (const artifact of fetched) store.getState().upsertArtifact(artifact)
        const heads = new Map(result.documents.map((doc) => [doc.id, doc.currentRevisionId]))
        for (const artifact of Object.values(store.getState().artifactsById)) {
          const current = artifact.document && heads.get(artifact.document.id)
          if (artifact.document && current && artifact.document.currentRevisionId !== current)
            store.getState().upsertArtifact({ ...artifact, document: { ...artifact.document, currentRevisionId: current } })
        }
      }
      catch { if (active) setError(true) }
      finally { running = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), DOCUMENT_PROGRESS_REFRESH_MS)
    return () => { active = false; window.clearInterval(timer) }
  }, [client, projectId, store, enabled])
  return { error: enabled && error }
}
