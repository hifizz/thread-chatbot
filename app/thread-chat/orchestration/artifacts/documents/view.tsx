"use client"

import { useEffect, useState } from "react"
import { DOCUMENT_UI_COPY } from "@/constants/project-documents"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { DocumentRevisionSummaryDTO } from "@/lib/thread-chat/contracts/document"
import type { ThreadChatClient } from "../../../net/client"
import { DocumentVersionHistory } from "./version-history"
import { DocumentDiff } from "./diff"

/** 只管理版本目录；导航资格由持有选区/草稿的上层明确传入。 */
export function DocumentView({ artifact, currentRevisionId, client, navigationBlocked, onShare, onSelect }: {
  currentRevisionId?: string
  artifact: ArtifactDTO; client: ThreadChatClient; navigationBlocked: boolean
  /** 分享入口：把文档当前版冻结为匿名只读链接 */
  onShare?(documentId: string): void
  onSelect(artifactId: string): void
}) {
  const document = artifact.document
  const documentId = document?.id
  const [history, setHistory] = useState<DocumentRevisionSummaryDTO[]>([])
  const [errorDocumentId, setErrorDocumentId] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!documentId) return
    let active = true
    void client.getDocumentHistory(documentId).then((rows) => {
      if (active) { setHistory(rows); setErrorDocumentId(null) }
    }).catch(() => { if (active) setErrorDocumentId(documentId) })
    return () => { active = false }
  }, [client, documentId, currentRevisionId, refresh])
  if (!document) return null
  // 切换文档时组件可能复用，history 会保留上一份文档的数据，直到新请求成功。
  // active 只阻止旧请求写入；此处过滤避免加载中或失败时显示上一份文档的版本。
  const revisions = history.filter((revision) => revision.documentId === document.id)
  const selected = revisions.find((revision) => revision.id === document.revisionId)
  const latest = revisions.find((revision) => revision.id === currentRevisionId)
  const previous = revisions.find((revision) => revision.id === selected?.parentRevisionId)
  return <div className="project-document-view">
    <DocumentVersionHistory revisions={revisions} revisionId={document.revisionId}
      currentRevisionId={currentRevisionId ?? document.revisionId} disabled={navigationBlocked} onSelect={(revision) => onSelect(revision.artifactId)} />
    {previous && <DocumentDiff key={`diff:${artifact.id}`} before={previous} after={artifact} client={client} />}
    {errorDocumentId === documentId && <p className="artifact-view-hint" role="alert">{DOCUMENT_UI_COPY.historyFailed} <button type="button" onClick={() => setRefresh((value) => value + 1)}>重新加载版本</button></p>}
    {navigationBlocked && <p className="artifact-view-hint" role="status">{DOCUMENT_UI_COPY.navigationBlocked}</p>}
    {latest && latest.id !== document.revisionId && (
      <button type="button" className="artifact-version-jump"
        disabled={navigationBlocked} onClick={() => onSelect(latest.artifactId)}>
        回到最新
      </button>
    )}
    {onShare && (
      <button type="button" className="artifact-version-jump"
        onClick={() => onShare(document.id)}>
        分享当前版
      </button>
    )}
    {artifact.sourceMessageStatus !== "completed" && <p className="artifact-view-hint">此版本已保存。来源回复尚未成功完成，暂时不能从这里开启分支。</p>}

  </div>
}
