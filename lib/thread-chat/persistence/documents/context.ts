import { eq, sql } from "drizzle-orm"
import { artifacts, documents, documentRevisions, messages } from "@/lib/db/schema"
import { DOCUMENT_LIMITS, DOCUMENT_RECEIPT_KIND } from "@/constants/project-documents"
import { documentContextReceiptSchema, type DocumentContextReceipt, type DocumentUpdateNotices } from "../../contracts/document"
import type { ConversationExecutor } from "../transaction"

/** 在提供商实际返回有效内容后记录；预算/初始化/提供商调用前失败不误推进。 */
export async function markDocumentContextUsed(executor: ConversationExecutor, messageId: string, manifest: DocumentContextReceipt) {
  const receipt = documentContextReceiptSchema.parse(manifest)
  if (!receipt.documents.length) return
  await executor.update(messages).set({ documentContextUsed: receipt }).where(eq(messages.id, messageId))
}

type NoticeRow = {
  documentId: string; revisionId: string; revisionNumber: number; artifactId: string; title: string
  commitId: string; number: number; summary: string; sourceThreadId: string; sourceMessageId: string
  omittedChangeCount: number
}

/** 单快照汇总当前 Thread 的收据；数据库只返回每文档最近 N 条。
 * 无标签 v1 的字段识别仅留在此持久化兼容边界；新收据按 kind 分支，未知版本不推进。
 */
export async function pendingDocumentNotices(executor: ConversationExecutor, projectId: string, threadId: string): Promise<DocumentUpdateNotices> {
  const rows = await executor.execute<NoticeRow>(sql`
    with used_entries as materialized (
      select entry, case when used_message.document_context_used ? 'kind'
        then used_message.document_context_used->>'kind' else
        case when entry ? 'commitIds' then ${DOCUMENT_RECEIPT_KIND.updates}
             when entry ? 'revisionNumber' then ${DOCUMENT_RECEIPT_KIND.notices} end end as kind
      from ${messages} used_message
      cross join lateral jsonb_array_elements(coalesce(used_message.document_context_used->'documents', '[]'::jsonb)) entry
      where used_message.thread_id = ${threadId} and used_message.project_id = ${projectId}
        and used_message.document_context_used->>'schemaVersion' = '1'
    ), cursors as (
      select entry->>'documentId' as document_id, max((entry->>'revisionNumber')::integer) as revision_number
      from used_entries where kind = ${DOCUMENT_RECEIPT_KIND.notices} group by entry->>'documentId'
    ), legacy_commits as (
      select distinct entry->>'documentId' as document_id, commit_id
      from used_entries cross join lateral jsonb_array_elements_text(
        case when kind = ${DOCUMENT_RECEIPT_KIND.updates} then coalesce(entry->'commitIds', '[]'::jsonb) else '[]'::jsonb end) commit_id
    ), pending as (
      select revision.id, revision.document_id, revision.revision_number,
        row_number() over (partition by revision.document_id order by revision.revision_number desc) as position,
        count(*) over (partition by revision.document_id) as total
      from ${documentRevisions} revision
      left join cursors on cursors.document_id = revision.document_id::text
      left join legacy_commits on legacy_commits.document_id = revision.document_id::text and legacy_commits.commit_id = revision.id::text
      where revision.project_id = ${projectId}
        and revision.revision_number > coalesce(cursors.revision_number, 0)
        and legacy_commits.commit_id is null
    )
    select doc.id as "documentId", head.id as "revisionId", head.revision_number as "revisionNumber",
      head.artifact_id as "artifactId", current_artifact.title,
      revision.id as "commitId", revision.revision_number as "number", revision.change_summary as "summary",
      source.thread_id as "sourceThreadId", source.source_message_id as "sourceMessageId",
      greatest(pending.total - ${DOCUMENT_LIMITS.noticeChanges}, 0)::integer as "omittedChangeCount"
    from pending
    inner join ${documentRevisions} revision on revision.id = pending.id
    inner join ${documents} doc on doc.id = pending.document_id and doc.project_id = ${projectId}
    inner join ${documentRevisions} head on head.id = doc.current_revision_id and head.document_id = doc.id
    inner join ${artifacts} current_artifact on current_artifact.id = head.artifact_id
    inner join ${artifacts} source on source.id = revision.artifact_id
    where pending.position <= ${DOCUMENT_LIMITS.noticeChanges}
    order by doc.id, revision.revision_number
  `)
  const entries = new Map<string, DocumentUpdateNotices["documents"][number]>()
  for (const row of rows) {
    const entry = entries.get(row.documentId) ?? {
      documentId: row.documentId, revisionId: row.revisionId, revisionNumber: row.revisionNumber,
      artifactId: row.artifactId, title: row.title, changes: [], omittedChangeCount: row.omittedChangeCount,
    }
    entry.changes.push({ commitId: row.commitId, revisionNumber: row.number,
      summary: row.summary, sourceThreadId: row.sourceThreadId, sourceMessageId: row.sourceMessageId })
    entries.set(row.documentId, entry)
  }
  return { schemaVersion: 1, documents: [...entries.values()] }
}
