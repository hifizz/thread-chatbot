import { and, count, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { conversationCommands, messages, projects } from "@/lib/db/schema"
import { DOCUMENT_COMMAND } from "@/constants/project-documents"
import type { DocumentExecution, DocumentReadResult, UpdateDocumentResult } from "../../contracts/document"
import type { ThreadChatUIMessage } from "../../contracts/ui-message"
import type { ConversationTransaction } from "../transaction"

/** 持久化结果包含执行身份；工具 DTO 不承担内部收据验证职责。 */
export type DocumentReadReceipt = DocumentReadResult & { executionId: string }
export type DocumentUpdateReceipt = UpdateDocumentResult & { executionId: string }

const readReceiptIdentitySchema = z.object({
  executionId: z.uuid(),
  revision: z.object({ id: z.uuid() }),
})

/** 与 Stop 使用同一 Project → Message 锁顺序。 */
export async function lockDocumentExecution(tx: ConversationTransaction, identity: DocumentExecution) {
  const [project] = await tx.select().from(projects)
    .where(and(eq(projects.id, identity.projectId), eq(projects.userId, identity.userId))).for("share")
  if (!project) return null
  const [message] = await tx.select().from(messages).where(and(eq(messages.id, identity.messageId),
    eq(messages.projectId, identity.projectId), eq(messages.threadId, identity.threadId))).for("update")
  return { project, message }
}

export async function countExecutionConflicts(tx: ConversationTransaction, identity: DocumentExecution, documentId: string) {
  const [row] = await tx.select({ count: count() }).from(conversationCommands).where(and(
    eq(conversationCommands.userId, identity.userId), eq(conversationCommands.scopeId, documentId),
    eq(conversationCommands.kind, DOCUMENT_COMMAND.update),
    sql`${conversationCommands.result}->>'status' = 'conflict'`,
    sql`${conversationCommands.result}->>'executionId' = ${identity.messageId}`,
  ))
  return row.count
}

export async function hasDocumentReadReceipt(tx: ConversationTransaction, identity: DocumentExecution,
  input: { documentId: string; readId: string; expectedRevisionId: string }): Promise<boolean> {
  const [row] = await tx.select({ result: conversationCommands.result }).from(conversationCommands).where(and(
    eq(conversationCommands.userId, identity.userId), eq(conversationCommands.id, input.readId),
    eq(conversationCommands.kind, DOCUMENT_COMMAND.read), eq(conversationCommands.scopeId, input.documentId),
  ))
  const receipt = readReceiptIdentitySchema.safeParse(row?.result)
  return receipt.success && receipt.data.executionId === identity.messageId
    && receipt.data.revision.id === input.expectedRevisionId
}

export async function saveDocumentToolResult(tx: ConversationTransaction, messageId: string, part: ThreadChatUIMessage["parts"][number]) {
  await tx.update(messages).set({ documentToolParts: sql`${messages.documentToolParts} || ${JSON.stringify([part])}::jsonb` })
    .where(and(eq(messages.id, messageId), eq(messages.status, "generating")))
}
