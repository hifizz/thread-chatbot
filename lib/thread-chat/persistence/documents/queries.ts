import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { artifacts, documents, documentRevisions, messages, projects } from "@/lib/db/schema"
import type { DocumentListItemDTO, DocumentRevisionDTO, DocumentRevisionSummaryDTO } from "../../contracts/document"
import type { ConversationExecutor } from "../transaction"

export async function findOwnedDocument(executor: ConversationExecutor, userId: string, documentId: string) {
  const [row] = await executor.select({ document: documents }).from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(and(eq(documents.id, documentId), eq(projects.userId, userId))).limit(1)
  return row?.document ?? null
}

const revisionColumns = {
  id: documentRevisions.id, documentId: documentRevisions.documentId,
  revisionNumber: documentRevisions.revisionNumber, parentRevisionId: documentRevisions.parentRevisionId,
  artifactId: artifacts.id, title: artifacts.title,
  changeSummary: documentRevisions.changeSummary, sourceThreadId: artifacts.threadId,
  sourceMessageId: artifacts.sourceMessageId, sourceMessageStatus: messages.status,
  createdAt: documentRevisions.createdAt,
}

function revisionQuery(executor: ConversationExecutor) {
  return executor.select({ ...revisionColumns, content: artifacts.content }).from(documentRevisions)
    .innerJoin(documents, eq(documents.id, documentRevisions.documentId))
    .innerJoin(artifacts, and(eq(artifacts.id, documentRevisions.artifactId), eq(artifacts.projectId, documents.projectId)))
    .innerJoin(messages, and(eq(messages.id, artifacts.sourceMessageId), eq(messages.projectId, artifacts.projectId), eq(messages.threadId, artifacts.threadId)))
}

export async function readDocumentRevision(executor: ConversationExecutor, documentId: string, revisionId: string): Promise<DocumentRevisionDTO | null> {
  const [row] = await revisionQuery(executor)
    .where(and(eq(documentRevisions.documentId, documentId), eq(documentRevisions.id, revisionId))).limit(1)
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null
}

export async function listDocumentHistory(executor: ConversationExecutor, documentId: string): Promise<DocumentRevisionSummaryDTO[]> {
  const rows = await executor.select(revisionColumns).from(documentRevisions)
    .innerJoin(artifacts, eq(artifacts.id, documentRevisions.artifactId))
    .innerJoin(messages, eq(messages.id, artifacts.sourceMessageId))
    .where(eq(documentRevisions.documentId, documentId)).orderBy(desc(documentRevisions.revisionNumber))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function listOwnedDocuments(executor: ConversationExecutor, userId: string, projectId: string, documentId?: string): Promise<DocumentListItemDTO[]> {
  const rows = await executor.select({ document: documents, title: artifacts.title, currentArtifactId: artifacts.id, sourceThreadId: artifacts.threadId, sourceMessageId: artifacts.sourceMessageId }).from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .innerJoin(documentRevisions, and(eq(documentRevisions.id, documents.currentRevisionId), eq(documentRevisions.documentId, documents.id)))
    .innerJoin(artifacts, and(eq(artifacts.id, documentRevisions.artifactId), eq(artifacts.projectId, documents.projectId)))
    .where(and(eq(projects.userId, userId), eq(documents.projectId, projectId), isNotNull(documents.currentRevisionId),
      documentId ? eq(documents.id, documentId) : undefined))
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


export async function listDocumentCommits(executor: ConversationExecutor, projectId: string, commitIds: readonly string[]) {
  if (!commitIds.length) return []
  const rows = await executor.select({ id: documentRevisions.id, documentId: documentRevisions.documentId,
    revisionNumber: documentRevisions.revisionNumber, changeSummary: documentRevisions.changeSummary,
    sourceThreadId: artifacts.threadId, sourceMessageId: artifacts.sourceMessageId, createdAt: documentRevisions.createdAt,
  }).from(documentRevisions).innerJoin(artifacts, eq(artifacts.id, documentRevisions.artifactId))
    .where(and(eq(artifacts.projectId, projectId), inArray(documentRevisions.id, [...new Set(commitIds)])))
    .orderBy(documentRevisions.documentId, documentRevisions.revisionNumber)
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

/** 只按固定 Revision ID 读取；不追随可变的文档 head。 */
export async function loadProjectDocumentRevisions(executor: ConversationExecutor, projectId: string, revisionIds: readonly string[]) {
  if (!revisionIds.length) return []
  const rows = await revisionQuery(executor).where(and(eq(documents.projectId, projectId),
    inArray(documentRevisions.id, [...new Set(revisionIds)])))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}
