"use client"

import { useMemo } from "react"
import { diffLines } from "diff"
import type { DocumentRevisionDTO } from "@/lib/thread-chat/contracts/document"

export function DocumentDiff({ before, after }: { before: DocumentRevisionDTO; after: DocumentRevisionDTO }) {
  const changes = useMemo(() => diffLines(before.content, after.content), [before.content, after.content])
  return <details className="inherited">
    <summary>查看差异：V{before.revisionNumber} → V{after.revisionNumber}</summary>
    <div className="inherited-body" aria-label="版本差异">
      {changes.map((change, index) => <pre key={index} className="whitespace-pre-wrap break-words text-xs">{change.added
        ? <ins>＋ {change.value}</ins> : change.removed ? <del>－ {change.value}</del> : change.value}</pre>)}
    </div>
  </details>
}
