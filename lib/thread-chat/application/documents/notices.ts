import type { ThreadChatUIMessage } from "../../contracts/ui-message"
import type { ConversationExecutor } from "../../persistence/transaction"
import { pendingDocumentNotices } from "../../persistence/documents/context"

export async function appendDocumentNotices(tx: ConversationExecutor, projectId: string,
  threadId: string, parts: ThreadChatUIMessage["parts"]) {
  const data = await pendingDocumentNotices(tx, projectId, threadId)
  if (data.documents.length) parts.push({ type: "data-document-update-notices", data })
}
