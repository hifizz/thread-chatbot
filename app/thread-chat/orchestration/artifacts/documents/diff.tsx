"use client"

import { useEffect, useMemo, useState } from "react"
import { diffLines } from "diff"
import { DOCUMENT_UI_COPY } from "@/constants/project-documents"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { DocumentRevisionSummaryDTO } from "@/lib/thread-chat/contracts/document"
import type { ThreadChatClient } from "../../../net/client"

/** 当前版本正文已经在阅读区；只在展开差异后请求其父版本。 */
export function DocumentDiff({ before, after, client }: {
  before: DocumentRevisionSummaryDTO; after: ArtifactDTO; client: ThreadChatClient
}) {
  const [open, setOpen] = useState(false)
  const [previous, setPrevious] = useState<ArtifactDTO | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const artifactId = before.artifactId
  useEffect(() => {
    if (!open) return
    let active = true
    void client.getArtifact(artifactId).then((artifact) => {
      if (active) { setPrevious(artifact); setError(false) }
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [client, artifactId, open, retry])
  const changes = useMemo(() => previous?.id === artifactId
    ? diffLines(previous.content, after.content) : null, [previous, artifactId, after.content])
  return <details className="inherited" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>查看差异：V{before.revisionNumber} → V{after.document?.revisionNumber}</summary>
    <div className="inherited-body" aria-label="版本差异">
      {error ? <p role="alert">{DOCUMENT_UI_COPY.diffFailed} <button type="button" onClick={() => setRetry((value) => value + 1)}>重新加载差异</button></p>
        : !changes ? <p role="status">正在加载差异…</p>
        : changes.map((change, index) => <pre key={index} className="whitespace-pre-wrap break-words text-xs">{change.added
          ? <ins>＋ {change.value}</ins> : change.removed ? <del>－ {change.value}</del> : change.value}</pre>)}
    </div>
  </details>
}
