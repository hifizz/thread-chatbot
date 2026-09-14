import { and, desc, eq, isNotNull } from "drizzle-orm"
import { artifacts, documents, documentRevisions, messages, projects } from "@/lib/db/schema"
import type { DocumentDTO, DocumentRevisionDTO } from "../contracts/document"
import type { ConversationExecutor, ConversationTransaction } from "./transaction"

export async function findOwnedDocument(executor: ConversationExecutor, userId: string, documentId: string) {
  const [row] = await executor.select({ document: documents }).from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(and(eq(documents.id, documentId), eq(projects.userId, userId))).limit(1)
  return row?.document ?? null
}

export async function readDocumentRevision(executor: ConversationExecutor, documentId: string, revisionId: string): Promise<DocumentRevisionDTO | null> {
  const [row] = await executor.select({ revision: documentRevisions, artifact: artifacts, status: messages.status })
    .from(documentRevisions)
    .innerJoin(documents, eq(documents.id, documentRevisions.documentId))
    .innerJoin(artifacts, and(eq(artifacts.id, documentRevisions.artifactId), eq(artifacts.projectId, documents.projectId)))
    .innerJoin(messages, and(eq(messages.id, artifacts.sourceMessageId), eq(messages.projectId, artifacts.projectId), eq(messages.threadId, artifacts.threadId)))
    .where(and(eq(documentRevisions.documentId, documentId), eq(documentRevisions.id, revisionId))).limit(1)
  if (!row) return null
  const { revision: r, artifact: a } = row
  return { id: r.id, documentId, revisionNumber: r.revisionNumber, parentRevisionId: r.parentRevisionId,
    artifactId: a.id, title: a.title, content: a.content, changeSummary: r.changeSummary,
    sourceThreadId: a.threadId, sourceMessageId: a.sourceMessageId,
    sourceMessageStatus: row.status, createdAt: r.createdAt.toISOString() }
}

export async function listOwnedDocuments(executor: ConversationExecutor, userId: string, projectId: string): Promise<DocumentDTO[]> {
  const rows = await executor.select({ document: documents, title: artifacts.title, currentArtifactId: artifacts.id, sourceThreadId: artifacts.threadId, sourceMessageId: artifacts.sourceMessageId }).from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .innerJoin(documentRevisions, and(eq(documentRevisions.id, documents.currentRevisionId), eq(documentRevisions.documentId, documents.id)))
    .innerJoin(artifacts, and(eq(artifacts.id, documentRevisions.artifactId), eq(artifacts.projectId, documents.projectId)))
    .where(and(eq(projects.userId, userId), eq(documents.projectId, projectId), isNotNull(documents.currentRevisionId)))
    .orderBy(desc(documents.createdAt), documents.id)
  return rows.map(({ document: d, title, currentArtifactId, sourceThreadId, sourceMessageId }) => ({ id: d.id, projectId: d.projectId,
    currentRevisionId: d.currentRevisionId!, currentArtifactId, title, sourceThreadId, sourceMessageId, archivedAt: d.archivedAt?.toISOString() ?? null }))
}

export async function documentForArtifact(executor: ConversationExecutor, userId: string, projectId: string, artifactId: string) {
  const [row] = await executor.select({ documentId: documents.id }).from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .innerJoin(documentRevisions, eq(documentRevisions.documentId, documents.id))
    .where(and(eq(projects.userId, userId), eq(documents.projectId, projectId), eq(documentRevisions.artifactId, artifactId))).limit(1)
  return row?.documentId ?? null
}

/** 调用方持有来源消息锁；同一 Artifact 登记可重复执行，不合并同名产物。 */
export async function registerDocumentArtifact(tx: ConversationTransaction, artifact: typeof artifacts.$inferSelect, userId: string) {
  const [existing] = await tx.select().from(documentRevisions).where(eq(documentRevisions.artifactId, artifact.id)).limit(1)
  if (existing) return existing
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
