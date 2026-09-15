import { DOCUMENT_RECEIPT_KIND } from "@/constants/project-documents"
import { parseDocumentContextReceipt, type StoredDocumentContextReceipt, type ProjectDocumentUpdates } from "../../contracts/document"
import type { ThreadChatUIMessage } from "../../contracts/ui-message"

interface ContextRow {
  id: string
  parts: ThreadChatUIMessage["parts"]
  documentContextUsed: StoredDocumentContextReceipt | null
}

/** 固定身份及提交集合相等；不依赖 JSON 对象键序、文档顺序或重复提交 ID。 */
function manifestKey(manifest: ProjectDocumentUpdates): string {
  return manifest.documents.map((entry) => [entry.documentId, entry.revisionId, entry.artifactId,
    [...new Set(entry.commitIds)].sort().join(",")].join(":")).sort().join("|")
}

/** 仅兼容旧版全文计划的失败过滤；新版摘要永远保留原位置。 */
export function documentContextForRequest(rows: readonly ContextRow[], activeUserId?: string) {
  let used: Set<string> | undefined
  const wasUsed = (manifest: ProjectDocumentUpdates) => {
    // 没有旧全文 Part 的普通请求不扫描/解析收据。
    used ??= new Set(rows.flatMap((row) => {
      if (!row.documentContextUsed) return []
      const receipt = parseDocumentContextReceipt(row.documentContextUsed)
      return receipt.kind === DOCUMENT_RECEIPT_KIND.updates ? [manifestKey(receipt)] : []
    }))
    return used.has(manifestKey(manifest))
  }
  return (message: ThreadChatUIMessage): ThreadChatUIMessage => ({ ...message,
    parts: message.parts.filter((part) => part.type !== "data-project-document-updates" ||
      message.id === activeUserId || wasUsed(part.data)),
  })
}
