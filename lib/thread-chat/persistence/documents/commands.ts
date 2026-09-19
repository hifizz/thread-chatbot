import { and, count, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { conversationCommands, messages, projects } from "@/lib/db/schema"
import { DOCUMENT_COMMAND } from "@/constants/project-documents"
import type {
  CommitDocumentResult,
  DocumentExecution,
  DocumentReadResult,
  DocumentWriteRejectionCode,
  EditDocumentResult,
  ResetDocumentDraftResult,
  UpdateDocumentResult,
} from "../../contracts/document"
import type { ThreadChatUIMessage } from "../../contracts/ui-message"
import type { ConversationTransaction } from "../transaction"

/** 持久化结果包含执行身份；工具 DTO 不承担内部收据验证职责。 */
export type DocumentReadReceipt = DocumentReadResult & { executionId: string }
export type DocumentUpdateReceipt = UpdateDocumentResult & { executionId: string }
export type DocumentEditReceipt = EditDocumentResult & { executionId: string }
export type DocumentCommitReceipt = CommitDocumentResult & { executionId: string }
export type DocumentResetReceipt = ResetDocumentDraftResult & { executionId: string }
export interface DocumentToolErrorReceipt {
  status: "rejected"
  code: Extract<DocumentWriteRejectionCode, "INVALID_TOOL_INPUT">
  toolName: string
  executionId: string
}

const readReceiptIdentitySchema = z.object({
  executionId: z.uuid(),
  revision: z.object({ id: z.uuid() }),
})
const draftReadReceiptSchema = z.object({
  executionId: z.uuid(),
  source: z.literal("draft"),
  draft: z.object({ id: z.uuid(), sequence: z.number().int().nonnegative() }),
})
const revisionReadReceiptSchema = z.object({
  executionId: z.uuid(),
  source: z.literal("revision").optional(),
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

export async function countExecutionConflicts(
  tx: ConversationTransaction, identity: DocumentExecution, documentId: string,
  kind: string = DOCUMENT_COMMAND.update
) {
  const [row] = await tx.select({ count: count() }).from(conversationCommands).where(and(
    eq(conversationCommands.userId, identity.userId), eq(conversationCommands.scopeId, documentId),
    eq(conversationCommands.kind, kind),
    sql`${conversationCommands.result}->>'status' = 'conflict'`,
    sql`${conversationCommands.result}->>'executionId' = ${identity.messageId}`,
  ))
  return row.count
}

/** 本执行文档写工具的结构化失败与 SDK 参数失败；同调用重放只占一行，不重复计数。 */
export async function countExecutionDocumentFailures(
  tx: ConversationTransaction, identity: DocumentExecution
) {
  const [row] = await tx.select({ count: count() }).from(conversationCommands).where(and(
    eq(conversationCommands.userId, identity.userId),
    inArray(conversationCommands.kind, [
      DOCUMENT_COMMAND.edit, DOCUMENT_COMMAND.commit,
      DOCUMENT_COMMAND.reset, DOCUMENT_COMMAND.toolError,
    ]),
    sql`${conversationCommands.result}->>'executionId' = ${identity.messageId}`,
    sql`${conversationCommands.result}->>'status' in ('rejected','conflict')`,
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

/** 编辑收据必须绑定本轮执行、文档、draftId 与 sequence；旧序号读取不能编辑新草稿。 */
export async function hasDraftReadReceipt(tx: ConversationTransaction, identity: DocumentExecution,
  input: { documentId: string; readId: string; draftId: string; expectedDraftSequence: number }): Promise<boolean> {
  const [row] = await tx.select({ result: conversationCommands.result }).from(conversationCommands).where(and(
    eq(conversationCommands.userId, identity.userId), eq(conversationCommands.id, input.readId),
    eq(conversationCommands.kind, DOCUMENT_COMMAND.read), eq(conversationCommands.scopeId, input.documentId),
  ))
  const receipt = draftReadReceiptSchema.safeParse(row?.result)
  return receipt.success && receipt.data.executionId === identity.messageId
    && receipt.data.draft.id === input.draftId
    && receipt.data.draft.sequence === input.expectedDraftSequence
}

/** reset 使用显式正式读取收据；无 source 的历史收据按正式读取兼容。 */
export async function hasRevisionReadReceipt(tx: ConversationTransaction, identity: DocumentExecution,
  input: { documentId: string; readId: string; revisionId: string }): Promise<boolean> {
  const [row] = await tx.select({ result: conversationCommands.result }).from(conversationCommands).where(and(
    eq(conversationCommands.userId, identity.userId), eq(conversationCommands.id, input.readId),
    eq(conversationCommands.kind, DOCUMENT_COMMAND.read), eq(conversationCommands.scopeId, input.documentId),
  ))
  const receipt = revisionReadReceiptSchema.safeParse(row?.result)
  return receipt.success && receipt.data.executionId === identity.messageId
    && receipt.data.revision.id === input.revisionId
}

export async function saveDocumentToolResult(tx: ConversationTransaction, messageId: string, part: ThreadChatUIMessage["parts"][number]) {
  await tx.update(messages).set({ documentToolParts: sql`${messages.documentToolParts} || ${JSON.stringify([part])}::jsonb` })
    .where(and(eq(messages.id, messageId), eq(messages.status, "generating")))
}
