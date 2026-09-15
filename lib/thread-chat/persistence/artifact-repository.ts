import { toDocumentListItemDTO } from "./documents/mappers"
import { toArtifactSummaryDTO } from "./mappers"
import type { ProjectDocumentsDTO } from "../contracts/document"
import { and, desc, eq, inArray, sql, getTableColumns, isNull, or } from "drizzle-orm"
import { artifacts, messages, projects, threads, documents, documentRevisions } from "@/lib/db/schema"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"

const artifactSourceSelection = {
  documentId: documents.id,
  documentRevisionId: documentRevisions.id,
  documentRevisionNumber: documentRevisions.revisionNumber,
  sourceThreadCustomTitle: threads.customTitle,
  sourceThreadAutoTitle: threads.autoTitle,
  sourceThreadFootnote: threads.footnote,
  sourceMessageStatus: messages.status,
}

function withSource(executor: ConversationExecutor, metadataOnly = false) {
  return executor
    .select({ ...artifactSourceSelection, artifact: { ...getTableColumns(artifacts), content: metadataOnly ? sql<string | null>`null` : artifacts.content } })
    .from(artifacts)
    .leftJoin(documentRevisions, eq(documentRevisions.artifactId, artifacts.id))
    .leftJoin(documents, and(eq(documents.id, documentRevisions.documentId), eq(documents.projectId, artifacts.projectId)))
    .innerJoin(
      messages,
      and(
        eq(messages.id, artifacts.sourceMessageId),
        eq(messages.projectId, artifacts.projectId),
        eq(messages.threadId, artifacts.threadId)
      )
    )
    .innerJoin(
      threads,
      and(
        eq(threads.id, artifacts.threadId),
        eq(threads.projectId, artifacts.projectId)
      )
    )
}

function requireContent<T extends { artifact: { content: string | null } }>(row: T) {
  const content = row.artifact.content
  if (content === null) throw new Error("ARTIFACT_CONTENT_NOT_LOADED")
  return { ...row, artifact: { ...row.artifact, content } }
}

export async function findOwnedArtifact(
  executor: ConversationExecutor,
  userId: string,
  artifactId: string
) {
  const [row] = await withSource(executor)
    .innerJoin(projects, eq(projects.id, artifacts.projectId))
    .where(and(eq(artifacts.id, artifactId), eq(projects.userId, userId)))
    .limit(1)
  return row ? requireContent(row) : null
}

/** 同一 SQL 快照同时返回权威 head 和完整条目，历史版本不进入当前目录。 */
export async function listOwnedProjectArtifactCatalog(
  executor: ConversationExecutor,
  userId: string,
  projectId: string
): Promise<ProjectDocumentsDTO> {
  const rows = await withSource(executor, true)
    .innerJoin(projects, eq(projects.id, artifacts.projectId))
    .where(and(eq(projects.userId, userId), eq(artifacts.projectId, projectId),
      or(isNull(documentRevisions.id), eq(documentRevisions.id, documents.currentRevisionId))))
    .orderBy(desc(artifacts.createdAt))
  return {
    artifacts: rows.map(toArtifactSummaryDTO),
    documents: rows.flatMap((row) => row.documentId && row.documentRevisionId && row.documentRevisionNumber
      ? [toDocumentListItemDTO({ ...row, documentId: row.documentId,
          documentRevisionId: row.documentRevisionId, documentRevisionNumber: row.documentRevisionNumber })] : []),
  }
}

/** 打开 Thread 时才取其固定产物元数据；不包含正文，也不写文档 head。 */
export async function listOwnedThreadArtifactRows(executor: ConversationExecutor, userId: string, threadId: string) {
  return withSource(executor, true).innerJoin(projects, eq(projects.id, artifacts.projectId))
    .where(and(eq(projects.userId, userId), eq(artifacts.threadId, threadId)))
    .orderBy(desc(artifacts.createdAt))
}

/** 调用方先校验 Project 所有权；返回来源状态，由应用层决定新引用规则。 */
export async function loadProjectReferenceArtifactRows(
  executor: ConversationExecutor,
  projectId: string,
  ids: readonly string[]
) {
  if (!ids.length) return []
  const rows = await withSource(executor).where(and(
    eq(artifacts.projectId, projectId),
    inArray(artifacts.id, [...new Set(ids)])
  ))
  return rows.map(requireContent)
}
