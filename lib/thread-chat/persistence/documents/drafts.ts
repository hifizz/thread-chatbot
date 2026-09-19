import { and, asc, count, eq, gt } from "drizzle-orm"
import { documentCheckpoints, documentDrafts, projects } from "@/lib/db/schema"
import type {
  DocumentCheckpointDTO,
  DocumentCheckpointKind,
  DocumentCheckpointSnapshotDTO,
  DocumentDraftDTO,
  DocumentDraftStatus,
  DocumentDraftSummaryDTO,
  MarkdownEdit,
} from "../../contracts/document"
import type { ConversationExecutor, ConversationTransaction } from "../transaction"

type DraftRow = typeof documentDrafts.$inferSelect
type CheckpointRow = typeof documentCheckpoints.$inferSelect

export function toDraftDTO(row: DraftRow): DocumentDraftDTO {
  return {
    id: row.id, projectId: row.projectId, messageId: row.messageId, documentId: row.documentId,
    baseRevisionId: row.baseRevisionId, content: row.content, sequence: row.sequence,
    status: row.status, committedRevisionId: row.committedRevisionId,
    finalReceipt: row.finalReceipt, closeReason: row.closeReason,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}

function toCheckpointDTO(row: CheckpointRow): DocumentCheckpointDTO {
  return {
    id: row.id, draftId: row.draftId, sequence: row.sequence, kind: row.kind,
    toolCallId: row.toolCallId, baseRevisionId: row.baseRevisionId,
    createdAt: row.createdAt.toISOString(),
  }
}

/** 调用方必须已经按 命令 → Project → Message → Document 顺序持锁；草稿锁是末位。 */
export async function lockDraftForExecution(
  tx: ConversationTransaction, messageId: string, documentId: string
): Promise<DocumentDraftDTO | null> {
  const [row] = await tx.select().from(documentDrafts)
    .where(and(eq(documentDrafts.messageId, messageId), eq(documentDrafts.documentId, documentId)))
    .for("update")
  return row ? toDraftDTO(row) : null
}

/** 创建后按唯一键回读并取行锁；并发首次读取在同一 Document 锁下串行，只建立一份草稿。 */
export async function createDocumentDraft(
  tx: ConversationTransaction,
  input: { projectId: string; messageId: string; documentId: string; baseRevisionId: string; content: string }
): Promise<DocumentDraftDTO> {
  await tx.insert(documentDrafts).values({
    id: crypto.randomUUID(), projectId: input.projectId, messageId: input.messageId,
    documentId: input.documentId, baseRevisionId: input.baseRevisionId, content: input.content,
  }).onConflictDoNothing()
  const draft = await lockDraftForExecution(tx, input.messageId, input.documentId)
  if (!draft) throw new Error("DRAFT_CREATE_FAILED")
  return draft
}

export async function appendDraftCheckpoint(
  tx: ConversationTransaction,
  input: {
    draftId: string; documentId: string; sequence: number; kind: DocumentCheckpointKind
    baseRevisionId: string; toolCallId: string; edits: MarkdownEdit[]; content: string
  }
): Promise<string> {
  const id = crypto.randomUUID()
  await tx.insert(documentCheckpoints).values({ id, ...input })
  return id
}

/** 与检查点追加处于同一事务；sequence 单调递增、旧序号不可复用。 */
export async function updateDraftWorkingCopy(
  tx: ConversationTransaction, draftId: string,
  patch: { content: string; sequence: number; baseRevisionId?: string }
): Promise<void> {
  await tx.update(documentDrafts).set({
    content: patch.content, sequence: patch.sequence,
    ...(patch.baseRevisionId ? { baseRevisionId: patch.baseRevisionId } : {}),
    updatedAt: new Date(),
  }).where(eq(documentDrafts.id, draftId))
}

export async function closeDocumentDraft(
  tx: ConversationTransaction, draftId: string,
  patch: {
    status: Exclude<DocumentDraftStatus, "editing">
    committedRevisionId?: string | null
    finalReceipt?: DocumentDraftDTO["finalReceipt"]
    closeReason?: string | null
  }
): Promise<void> {
  await tx.update(documentDrafts).set({
    status: patch.status,
    committedRevisionId: patch.committedRevisionId ?? null,
    finalReceipt: patch.finalReceipt ?? null,
    closeReason: patch.closeReason ?? null,
    updatedAt: new Date(),
  }).where(eq(documentDrafts.id, draftId))
}

/** 生命周期终结入口共用；只按 messageId 关闭 editing 草稿，不反向获取 Document 锁。 */
export async function abandonEditingDrafts(
  tx: ConversationTransaction, messageId: string, closeReason: string
): Promise<number> {
  const rows = await tx.update(documentDrafts)
    .set({ status: "abandoned", closeReason, updatedAt: new Date() })
    .where(and(eq(documentDrafts.messageId, messageId), eq(documentDrafts.status, "editing")))
    .returning({ id: documentDrafts.id })
  return rows.length
}

export async function listEditingDrafts(
  executor: ConversationExecutor, messageId: string
): Promise<DocumentDraftDTO[]> {
  const rows = await executor.select().from(documentDrafts)
    .where(and(eq(documentDrafts.messageId, messageId), eq(documentDrafts.status, "editing")))
    .orderBy(documentDrafts.documentId)
  return rows.map(toDraftDTO)
}

/** 只读 API：先验证消息归属，再按 messageId 读取草稿摘要与检查点数量。 */
export async function listMessageDraftSummaries(
  executor: ConversationExecutor, messageId: string
): Promise<DocumentDraftSummaryDTO[]> {
  const rows = await executor.select({ draft: documentDrafts, checkpointCount: count(documentCheckpoints.id) })
    .from(documentDrafts)
    .leftJoin(documentCheckpoints, eq(documentCheckpoints.draftId, documentDrafts.id))
    .where(eq(documentDrafts.messageId, messageId))
    .groupBy(documentDrafts.id)
    .orderBy(documentDrafts.documentId)
  return rows.map(({ draft, checkpointCount }) => {
    const dto = toDraftDTO(draft)
    return {
      id: dto.id, baseRevisionId: dto.baseRevisionId, sequence: dto.sequence, status: dto.status,
      documentId: dto.documentId, messageId: dto.messageId,
      committedRevisionId: dto.committedRevisionId, finalReceipt: dto.finalReceipt,
      closeReason: dto.closeReason, checkpointCount, createdAt: dto.createdAt, updatedAt: dto.updatedAt,
    }
  })
}

/** 草稿归属经其执行消息归属验证；返回草稿行供上层组装只读 DTO。 */
export async function findOwnedDraft(
  executor: ConversationExecutor, userId: string, draftId: string
): Promise<DocumentDraftDTO | null> {
  const [row] = await executor.select({ draft: documentDrafts }).from(documentDrafts)
    .innerJoin(projects, eq(projects.id, documentDrafts.projectId))
    .where(and(eq(documentDrafts.id, draftId), eq(projects.userId, userId))).limit(1)
  return row ? toDraftDTO(row.draft) : null
}

/** 分页只列摘要，不返回全文；游标为上一页最后一个 sequence。 */
export async function listDraftCheckpoints(
  executor: ConversationExecutor, draftId: string, cursor: number | undefined, limit: number
): Promise<{ checkpoints: DocumentCheckpointDTO[]; nextCursor: number | null }> {
  const rows = await executor.select().from(documentCheckpoints)
    .where(and(eq(documentCheckpoints.draftId, draftId),
      cursor === undefined ? undefined : gt(documentCheckpoints.sequence, cursor)))
    .orderBy(asc(documentCheckpoints.sequence)).limit(limit + 1)
  const page = rows.slice(0, limit)
  return {
    checkpoints: page.map(toCheckpointDTO),
    nextCursor: rows.length > limit ? page.at(-1)!.sequence : null,
  }
}

export async function findDraftCheckpoint(
  executor: ConversationExecutor, draftId: string, sequence: number
): Promise<DocumentCheckpointSnapshotDTO | null> {
  const [row] = await executor.select().from(documentCheckpoints)
    .where(and(eq(documentCheckpoints.draftId, draftId), eq(documentCheckpoints.sequence, sequence)))
    .limit(1)
  return row ? { ...toCheckpointDTO(row), edits: row.edits, content: row.content } : null
}
