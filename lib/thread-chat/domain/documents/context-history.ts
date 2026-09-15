import type { DocumentContextReceipt } from "../../contracts/document"
import type { ThreadChatUIMessage } from "../../contracts/ui-message"

interface ContextRow {
  id: string
  parts: ThreadChatUIMessage["parts"]
  documentContextUsed: DocumentContextReceipt | null
}

/** 仅兼容旧版全文计划的失败过滤；新版摘要永远保留原位置，不随收据变化删改历史。 */
export function documentContextForRequest(rows: readonly ContextRow[], activeUserId?: string) {
  const used = new Set(rows.flatMap((row) => row.documentContextUsed ? [JSON.stringify(row.documentContextUsed)] : []))
  return (message: ThreadChatUIMessage): ThreadChatUIMessage => ({ ...message,
    parts: message.parts.filter((part) => part.type !== "data-project-document-updates" ||
      message.id === activeUserId || used.has(JSON.stringify(part.data))),
  })
}
