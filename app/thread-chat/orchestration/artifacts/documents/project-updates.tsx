"use client"

import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import { DOCUMENT_PROGRESS_REFRESH_MS } from "@/constants/project-documents"
import type { ThreadChatClient } from "../../../net/client"
import type { ConversationStore } from "../../../core/store"
import { useConversationStore } from "../../../core/use-thread-store"

/** 勾选仅选择下一轮主线输入范围；不会标记模型已读，也不会启动生成。 */
export function ProjectDocumentUpdates({ projectId, client, store }: {
  projectId: string; client: ThreadChatClient; store: ConversationStore
}) {
  const [data, setData] = useState<Awaited<ReturnType<ThreadChatClient["listDocuments"]>> | null>(null)
  const [error, setError] = useState(false)
  const threads = useConversationStore(store, (state) => state.threadsById)
  const scope = useConversationStore(store, (state) => state.workspace.documentScope)
  useEffect(() => {
    let active = true
    let running = false
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const result = await client.listDocuments(projectId)
        if (!active) return
        setData(result); setError(false)
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
  }, [client, projectId, store])
  if (error) return <p role="status">文档进展暂时无法加载，正在重试。</p>
  if (data?.documents.some((doc) => doc.projectId !== projectId)) return null
  if (!data?.pending.documents.length) return null
  const selected = scope?.projectId === projectId ? scope.ids : undefined
  const pendingIds = data.pending.documents.map((item) => item.documentId)
  return <details className="project-document-disclosure project-document-progress">
    <summary><ChevronRight size={14} aria-hidden="true" /><span>主线待接收更新</span><span className="project-document-meta">{pendingIds.length} 份</span></summary>
    <div className="project-document-disclosure-body">
      <p>下一次在主线发送消息时带入所选文档。查看此处不会标记为已接收。</p>
      {data.documents.filter((doc) => pendingIds.includes(doc.id)).map((doc) => <label key={doc.id} className="project-document-scope-item">
        <span><input type="checkbox" checked={selected === undefined || selected.includes(doc.id)} onChange={(event) => {
          const ids = new Set(selected ?? pendingIds)
          if (event.target.checked) ids.add(doc.id); else ids.delete(doc.id)
          store.getState().setWorkspace({ documentScope: { projectId, ids: [...ids] } })
        }} /> {doc.title} · {data.pending.documents.find((item) => item.documentId === doc.id)?.commitIds.length} 次提交</span>
        {data.commits.filter((commit) => commit.documentId === doc.id).map((commit) => <small key={commit.id}>
          V{commit.revisionNumber} · {commit.changeSummary} · {threads[commit.sourceThreadId]?.customTitle ?? threads[commit.sourceThreadId]?.autoTitle ?? "来源 Thread"}
        </small>)}
      </label>)}
      <button type="button" className="project-secondary" onClick={() => store.getState().setWorkspace({ documentScope: undefined })}>恢复默认：接收全部更新</button>
    </div>
  </details>
}
