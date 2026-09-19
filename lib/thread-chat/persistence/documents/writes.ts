import { eq } from "drizzle-orm"
import { artifacts, documents, documentRevisions, messages } from "@/lib/db/schema"
import type { DocumentExecution, DocumentRevisionDTO, MarkdownEdit } from "../../contracts/document"
import { canRegisterDocument } from "../../domain/documents/execution"
import { artifactIdForTool } from "../../domain/tool-identity"
import type { ConversationTransaction } from "../transaction"

export async function lockDocument(tx: ConversationTransaction, documentId: string) {
  const [document] = await tx.select().from(documents).where(eq(documents.id, documentId)).for("update")
  return document ?? null
}

export interface AppendDocumentRevisionInput {
  documentId: string
  base: DocumentRevisionDTO
  content: string
  changeSummary: string
  /** 新协议提交为空数组并依赖检查点审计；旧即时协议保留原始 patch。 */
  edits: MarkdownEdit[]
  /** 新协议正式版本回溯来源草稿；旧协议与历史行为 null。 */
  sourceDraftId: string | null
  toolCallId: string
  commandId: string
}

/** 必须在持有文档锁的同一事务内追加固定正文、版本和 head。 */
export async function appendDocumentRevision(tx: ConversationTransaction, identity: DocumentExecution,
  input: AppendDocumentRevisionInput) {
  const artifactId = artifactIdForTool(identity.messageId, input.toolCallId)
  const revisionId = crypto.randomUUID()
  await tx.insert(artifacts).values({ id: artifactId, projectId: identity.projectId,
    threadId: identity.threadId, sourceMessageId: identity.messageId, kind: "markdown",
    title: input.base.title, content: input.content, metadata: { toolCallId: input.toolCallId, documentId: input.documentId, revisionId } })
  await tx.insert(documentRevisions).values({ id: revisionId, documentId: input.documentId, projectId: identity.projectId,
    revisionNumber: input.base.revisionNumber + 1, parentRevisionId: input.base.id, artifactId,
    changeSummary: input.changeSummary, edits: input.edits, actorUserId: identity.userId,
    commandId: input.commandId, executionId: identity.messageId, toolCallId: input.toolCallId,
    sourceDraftId: input.sourceDraftId })
  await tx.update(documents).set({ currentRevisionId: revisionId }).where(eq(documents.id, input.documentId))
  return { status: "committed" as const, documentId: input.documentId, previousRevisionId: input.base.id,
    revisionId, artifactId, changeSummary: input.changeSummary }
}

/** 调用方持有来源消息锁；同一 Artifact 登记可重复执行，不合并同名产物。 */
export async function registerDocumentArtifact(tx: ConversationTransaction, artifact: typeof artifacts.$inferSelect, userId: string) {
  const [existing] = await tx.select().from(documentRevisions).where(eq(documentRevisions.artifactId, artifact.id)).limit(1)
  if (existing) return existing
  const [source] = await tx.select({ role: messages.role, status: messages.status }).from(messages)
    .where(eq(messages.id, artifact.sourceMessageId))
  if (!canRegisterDocument(source)) return null
  if (artifact.kind !== "markdown") throw new Error("DOCUMENT_KIND_INVALID")
  const id = crypto.randomUUID()
  const revisionId = crypto.randomUUID()
  await tx.insert(documents).values({ id, projectId: artifact.projectId })
  const [revision] = await tx.insert(documentRevisions).values({ id: revisionId, documentId: id, projectId: artifact.projectId,
    revisionNumber: 1, artifactId: artifact.id, changeSummary: "创建文档", actorUserId: userId,
    executionId: artifact.sourceMessageId,
    toolCallId: typeof artifact.metadata.toolCallId === "string" ? artifact.metadata.toolCallId : null,
  }).returning()
  await tx.update(documents).set({ currentRevisionId: revisionId }).where(eq(documents.id, id))
  return revision
}
