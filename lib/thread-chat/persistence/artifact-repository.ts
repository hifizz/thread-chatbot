import { and, desc, eq, inArray, sql, getTableColumns } from "drizzle-orm"
import { artifacts, messages, projects, threads, documents, documentRevisions } from "@/lib/db/schema"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"

const artifactSourceSelection = {
  documentId: documents.id,
  documentRevisionId: documentRevisions.id,
  documentRevisionNumber: documentRevisions.revisionNumber,
  documentCurrentRevisionId: documents.currentRevisionId,
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

export function listProjectArtifactRows(
  executor: ConversationExecutor,
  projectId: string
) {
  return withSource(executor, true)
    .where(eq(artifacts.projectId, projectId))
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
