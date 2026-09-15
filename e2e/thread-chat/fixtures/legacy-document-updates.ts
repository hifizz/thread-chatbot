import { eq, sql } from "drizzle-orm"
import { artifacts, documents, documentRevisions, messages } from "@/lib/db/schema"
import type { ProjectDocumentUpdates } from "@/lib/thread-chat/contracts/document"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"

// 已退役的全文通知生产者，仅用于构造旧数据兼容性夹具。
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
