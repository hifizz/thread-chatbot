import { eq, sql } from "drizzle-orm"
import { artifacts, documents, documentRevisions, messages } from "@/lib/db/schema"
import { alias } from "drizzle-orm/pg-core"
import { DOCUMENT_LIMITS } from "@/constants/project-documents"
import type { DocumentContextReceipt, DocumentUpdateNotices, ProjectDocumentUpdates } from "../../contracts/document"
import type { ConversationExecutor } from "../transaction"

/** 单个 SQL 快照同时读取 head、提交与实际使用记录，不逐文件追随可变 head。 */
export async function pendingDocumentUpdates(executor: ConversationExecutor, projectId: string, rootThreadId: string, scope?: readonly string[]): Promise<ProjectDocumentUpdates> {
  const rows = await executor.select({ documentId: documents.id, revisionId: documents.currentRevisionId,
    artifactId: artifacts.id, commitId: documentRevisions.id, number: documentRevisions.revisionNumber,
    consumed: sql<boolean>`exists (
      select 1 from ${messages} used_message,
      jsonb_array_elements(coalesce(used_message.document_context_used->'documents', '[]'::jsonb)) entry
      where used_message.thread_id = ${rootThreadId}
      and used_message.project_id = ${projectId}
      and (entry->'commitIds') ? ${documentRevisions.id}
    )`,
  }).from(documents)
    .innerJoin(documentRevisions, eq(documentRevisions.documentId, documents.id))
    .innerJoin(artifacts, sql`${artifacts.id} = (select head.artifact_id from ${documentRevisions} head where head.id = ${documents.currentRevisionId} and head.document_id = ${documents.id})`)
    .where(eq(documents.projectId, projectId))
    .orderBy(documents.id, documentRevisions.revisionNumber)
  const entries = new Map<string, ProjectDocumentUpdates["documents"][number]>()
  for (const row of rows) {
    if (!row.revisionId || row.consumed || (scope && !scope.includes(row.documentId))) continue
    const entry = entries.get(row.documentId) ?? { documentId: row.documentId, revisionId: row.revisionId, artifactId: row.artifactId, commitIds: [] }
    entry.commitIds.push(row.commitId)
    entries.set(row.documentId, entry)
  }
  return { schemaVersion: 1, documents: [...entries.values()] }
}

/** 在提供商实际返回有效内容后记录；预算/初始化/提供商调用前失败不误推进。 */
export async function markDocumentContextUsed(executor: ConversationExecutor, messageId: string, manifest: DocumentContextReceipt) {
  if (!manifest.documents.length) return
  await executor.update(messages).set({ documentContextUsed: manifest }).where(eq(messages.id, messageId))
}

/** 同一 SQL 快照；通知位置只属于当前 Thread，不是全项目或主线的共同位置。 */
export async function pendingDocumentNotices(executor: ConversationExecutor, projectId: string, threadId: string): Promise<DocumentUpdateNotices> {
  const head = alias(documentRevisions, "notice_head")
  const source = alias(artifacts, "notice_source")
  const rows = await executor.select({
    documentId: documents.id, revisionId: head.id, revisionNumber: head.revisionNumber,
    artifactId: artifacts.id, title: artifacts.title,
    commitId: documentRevisions.id, number: documentRevisions.revisionNumber,
    summary: documentRevisions.changeSummary,
    sourceThreadId: source.threadId, sourceMessageId: source.sourceMessageId,
  }).from(documents)
    .innerJoin(head, eq(head.id, documents.currentRevisionId))
    .innerJoin(artifacts, eq(artifacts.id, head.artifactId))
    .innerJoin(documentRevisions, eq(documentRevisions.documentId, documents.id))
    .innerJoin(source, eq(source.id, documentRevisions.artifactId))
    .where(sql`${documents.projectId} = ${projectId} and not exists (
      select 1 from ${messages} used_message,
      jsonb_array_elements(coalesce(used_message.document_context_used->'documents', '[]'::jsonb)) entry
      where used_message.thread_id = ${threadId} and used_message.project_id = ${projectId}
      and entry->>'documentId' = ${documents.id}
      and ((entry->'commitIds') ? ${documentRevisions.id}
        or (entry->>'revisionNumber')::integer >= ${documentRevisions.revisionNumber})
    )`)
    .orderBy(documents.id, documentRevisions.revisionNumber)
  const entries = new Map<string, DocumentUpdateNotices["documents"][number]>()
  for (const row of rows) {
    const entry = entries.get(row.documentId) ?? {
      documentId: row.documentId, revisionId: row.revisionId, revisionNumber: row.revisionNumber,
      artifactId: row.artifactId, title: row.title, changes: [], omittedChangeCount: 0,
    }
    entry.changes.push({ commitId: row.commitId, revisionNumber: row.number,
      summary: row.summary, sourceThreadId: row.sourceThreadId, sourceMessageId: row.sourceMessageId })
    if (entry.changes.length > DOCUMENT_LIMITS.noticeChanges) {
      entry.changes.shift()
      entry.omittedChangeCount++
    }
    entries.set(row.documentId, entry)
  }
  return { schemaVersion: 1, documents: [...entries.values()] }
}
