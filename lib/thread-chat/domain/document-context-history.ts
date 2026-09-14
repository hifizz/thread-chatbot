import type { ProjectDocumentUpdates } from "../contracts/document"
import type { ThreadChatUIMessage } from "../contracts/ui-message"

interface ContextRow {
  id: string
  parts: ThreadChatUIMessage["parts"]
  documentContextUsed: ProjectDocumentUpdates | null
}

/** 历史中从未进入请求的计划清单不补发；本轮清单与实际使用过的固定历史保留。 */
export function documentContextForRequest(rows: readonly ContextRow[], activeUserId?: string) {
  const used = new Set(rows.flatMap((row) => row.documentContextUsed ? [JSON.stringify(row.documentContextUsed)] : []))
  return (message: ThreadChatUIMessage): ThreadChatUIMessage => ({ ...message,
    parts: message.parts.filter((part) => part.type !== "data-project-document-updates" ||
      message.id === activeUserId || used.has(JSON.stringify(part.data))),
  })
}
