"use client"

import { useEffect, useState } from "react"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { DocumentRevisionDTO } from "@/lib/thread-chat/contracts/document"
import type { ThreadChatClient } from "../../net/client"
import { DocumentVersionHistory } from "./document-version-history"
import { documentExportSnapshot } from "@/lib/thread-chat/domain/document-export"
import { DocumentDiff } from "./document-diff"

/** 只负责固定版本导航；正文与划选仍由现有阅读区承载。 */
export function DocumentView({ artifact, client, onSelect }: {
  artifact: ArtifactDTO; client: ThreadChatClient; onSelect(artifactId: string): void
}) {
  const document = artifact.document
  const documentId = document?.id
  const currentRevisionId = document?.currentRevisionId
  const [history, setHistory] = useState<DocumentRevisionDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!documentId) return
    let active = true
    void client.getDocumentHistory(documentId).then((rows) => {
      if (active) { setHistory(rows); setError(null) }
    }).catch(() => { if (active) setError("版本记录加载失败") })
    return () => { active = false }
  }, [client, documentId, currentRevisionId, refresh])
  if (!document) return null
  const revisions = history.filter((revision) => revision.documentId === document.id)
  const selected = revisions.find((revision) => revision.id === document.revisionId)
  const latest = revisions[0]
  const previous = revisions.find((revision) => revision.id === selected?.parentRevisionId)
  const switchVersion = (revision: DocumentRevisionDTO) => {
    // 既有提问弹窗保持草稿；用户关闭后再显式切换，避免锚点被绑到新正文。
    if (window.document.querySelector('[data-question-dialog-open="true"]')) {
      setError("请先完成或关闭当前提问，再切换版本")
      return
    }
    window.getSelection()?.removeAllRanges()
    onSelect(revision.artifactId)
  }
  const exportVersion = async (share: boolean) => {
    const snapshot = documentExportSnapshot(artifact)
    const file = new File([snapshot.content], snapshot.filename, { type: snapshot.mimeType })
    if (share) {
      if (!navigator.canShare?.({ files: [file] })) {
        setError("当前浏览器不支持文件分享，请先导出此版本再分享。")
        return
      }
      try { await navigator.share({ files: [file], title: artifact.title }) }
      catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("分享失败，请重试或导出此版本。") }
      return
    }
    const url = URL.createObjectURL(file)
    const link = window.document.createElement("a")
    link.href = url; link.download = snapshot.filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return <div className="project-document-view">
    {error && <p role="alert">{error} <button type="button" onClick={() => setRefresh((value) => value + 1)}>重试</button></p>}
    <DocumentVersionHistory revisions={revisions} revisionId={document.revisionId}
      currentRevisionId={latest?.id ?? document.currentRevisionId} onSelect={switchVersion} />
    {latest && latest.id !== document.revisionId && <p>
      正在查看历史版本 <button type="button" className="project-secondary" onClick={() => switchVersion(latest)}>查看最新版本</button>
    </p>}
    {artifact.sourceMessageStatus !== "completed" && <p>此版本已保存。来源回复尚未成功完成，暂时不能从这里开启分支。</p>}
    <div>
      <button type="button" className="project-secondary" onClick={() => void exportVersion(false)}>导出当前版本</button>
      <button type="button" className="project-secondary" onClick={() => void exportVersion(true)}>分享当前版本文件</button>
    </div>
    {selected && previous && <DocumentDiff before={previous} after={selected} />}
  </div>
}
