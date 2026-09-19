import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { conversationCommands, documents } from "@/lib/db/schema"
import { db } from "@/lib/db"
import {
  DOCUMENT_COMMAND,
  DOCUMENT_DRAFT_CLOSE_REASON,
  DOCUMENT_LIMITS,
  DOCUMENT_RESULT_COPY,
} from "@/constants/project-documents"
import { AI_DIAGNOSTIC_EVENTS } from "@/constants/observability"
import { logDiagnostic } from "@/lib/observability/diagnostic-log"
import { isActiveDocumentExecution } from "../../domain/documents/execution"
import { applyDocumentEdits } from "../../domain/documents/edit"
import { artifactIdForTool } from "../../domain/tool-identity"
import { executeIdempotentCommand } from "../../persistence/command-repository"
import {
  countExecutionConflicts,
  countExecutionDocumentFailures,
  hasDraftReadReceipt,
  hasRevisionReadReceipt,
  lockDocumentExecution,
  saveDocumentToolResult,
  type DocumentCommitReceipt,
  type DocumentEditReceipt,
  type DocumentReadReceipt,
  type DocumentResetReceipt,
  type DocumentToolErrorReceipt,
} from "../../persistence/documents/commands"
import {
  abandonEditingDrafts,
  appendDraftCheckpoint,
  closeDocumentDraft,
  createDocumentDraft,
  findDraftCheckpoint,
  findOwnedDraft,
  listDraftCheckpoints,
  listEditingDrafts,
  listMessageDraftSummaries,
  lockDraftForExecution,
  updateDraftWorkingCopy,
} from "../../persistence/documents/drafts"
import { findOwnedDocument, readDocumentRevision } from "../../persistence/documents/queries"
import { appendDocumentRevision, lockDocument } from "../../persistence/documents/writes"
import { findOwnedMessage } from "../../persistence/message-repository"
import { withConversationTransaction, type ConversationTransaction } from "../../persistence/transaction"
import {
  commitDocumentInputSchema,
  editDocumentInputSchema,
  resetDocumentDraftInputSchema,
  type CommitDocumentInput,
  type CommitDocumentResult,
  type DocumentCheckpointListDTO,
  type DocumentCheckpointSnapshotDTO,
  type DocumentDraftDTO,
  type DocumentDraftListDTO,
  type DocumentDraftReadResult,
  type DocumentExecution,
  type DocumentReadResult,
  type DocumentWriteRejectionCode,
  type EditDocumentInput,
  type EditDocumentResult,
  type ReadDocumentInput,
  type ResetDocumentDraftInput,
  type ResetDocumentDraftResult,
} from "../../contracts/document"
import { notFound } from "../errors"
import { documentWritesEnabled } from "./configuration"

/** 失败留痕本身无法持久化时，本执行进程内停止文档写入（运维错误另记日志）。 */
const writeBlockedExecutions = new Set<string>()
export function isDocumentWriteBlocked(messageId: string): boolean {
  return writeBlockedExecutions.has(messageId)
}
export function blockDocumentWrites(messageId: string): void {
  writeBlockedExecutions.add(messageId)
}

function rejected(code: DocumentWriteRejectionCode) {
  return { status: "rejected" as const, code }
}
type OwnedDocument = Pick<typeof documents.$inferSelect, "id" | "projectId" | "currentRevisionId">

async function baseTitle(tx: ConversationTransaction, documentId: string, baseRevisionId: string) {
  const base = await readDocumentRevision(tx, documentId, baseRevisionId)
  if (!base) notFound()
  return base.title
}

function draftReadResult(owned: OwnedDocument, title: string,
  draft: DocumentDraftDTO, readId: string, executionId: string): DocumentDraftReadResult & { executionId: string } {
  return {
    source: "draft",
    document: { id: owned.id, projectId: owned.projectId, currentRevisionId: owned.currentRevisionId!, title },
    draft: { id: draft.id, baseRevisionId: draft.baseRevisionId, sequence: draft.sequence, status: draft.status },
    content: draft.content, readId, executionId,
  }
}

/**
 * 默认读取返回本轮工作副本；显式 revisionId 永远返回固定正式版本。
 * 首次允许时在同一把 Document 锁下创建 sequence 0 草稿；只读/写入关闭时保持正式读取。
 */
export async function readProjectDocument(
  identity: DocumentExecution, input: ReadDocumentInput, toolCallId: string
): Promise<DocumentReadResult> {
  return withConversationTransaction(async (tx) => {
    const owned = await findOwnedDocument(tx, identity.userId, input.documentId)
    if (!owned?.currentRevisionId || owned.projectId !== identity.projectId) notFound()
    const readId = artifactIdForTool(identity.messageId, `read:${toolCallId}`)
    const receipt = await executeIdempotentCommand<DocumentReadReceipt>({ tx, userId: identity.userId,
      commandId: readId, kind: DOCUMENT_COMMAND.read, scopeId: owned.id,
      payload: { input, identity, toolCallId }, execute: async () => {
        const execution = await lockDocumentExecution(tx, identity)
        if (!execution) notFound()
        const { project, message } = execution
        if (!isActiveDocumentExecution(message))
          throw new Error("EXECUTION_INACTIVE")
        if (input.revisionId) {
          const revision = await readDocumentRevision(tx, owned.id, input.revisionId)
          if (!revision) notFound()
          return { source: "revision" as const,
            document: { id: owned.id, projectId: owned.projectId, currentRevisionId: owned.currentRevisionId!, title: revision.title },
            revision, readId, isCurrent: revision.id === owned.currentRevisionId,
            executionId: identity.messageId }
        }
        const doc = await lockDocument(tx, owned.id)
        if (!doc?.currentRevisionId) notFound()
        const locked = { ...owned, currentRevisionId: doc.currentRevisionId }
        const existing = await lockDraftForExecution(tx, identity.messageId, owned.id)
        if (existing)
          return draftReadResult(locked,
            await baseTitle(tx, owned.id, existing.baseRevisionId), existing, readId, identity.messageId)
        if (!project.archivedAt && documentWritesEnabled()) {
          const base = await readDocumentRevision(tx, owned.id, doc.currentRevisionId)
          if (!base) notFound()
          const draft = await createDocumentDraft(tx, { projectId: owned.projectId,
            messageId: identity.messageId, documentId: owned.id,
            baseRevisionId: base.id, content: base.content })
          return draftReadResult(locked, base.title, draft, readId, identity.messageId)
        }
        const revision = await readDocumentRevision(tx, owned.id, doc.currentRevisionId)
        if (!revision) notFound()
        return { source: "revision" as const,
          document: { id: owned.id, projectId: owned.projectId, currentRevisionId: doc.currentRevisionId, title: revision.title },
          revision, readId, isCurrent: true, executionId: identity.messageId }
      } })
    if (!receipt.replayed) await saveDocumentToolResult(tx, identity.messageId, {
      type: "tool-readProjectDocument", toolCallId, state: "output-available", input, output: receipt.result,
    })
    return receipt.result
  })
}

async function checkWriteAllowance(tx: ConversationTransaction, identity: DocumentExecution,
  project: { archivedAt: Date | null }, message: Parameters<typeof isActiveDocumentExecution>[0]) {
  if (!documentWritesEnabled()) return rejected("WRITES_DISABLED")
  if (project.archivedAt) return rejected("DOCUMENT_READ_ONLY")
  if (!isActiveDocumentExecution(message)) return rejected("EXECUTION_INACTIVE")
  if (isDocumentWriteBlocked(identity.messageId)) return rejected("FAILURE_BUDGET_EXCEEDED")
  if (await countExecutionDocumentFailures(tx, identity) >= DOCUMENT_LIMITS.failureBudget)
    return rejected("FAILURE_BUDGET_EXCEEDED")
  return null
}

export async function editProjectDocument(
  identity: DocumentExecution, raw: EditDocumentInput, toolCallId: string
): Promise<EditDocumentResult> {
  const input = editDocumentInputSchema.parse(raw)
  return withConversationTransaction(async (tx) => {
    const owned = await findOwnedDocument(tx, identity.userId, input.documentId)
    if (!owned || owned.projectId !== identity.projectId) notFound()
    const commandId = artifactIdForTool(identity.messageId, `edit:${toolCallId}`)
    const receipt = await executeIdempotentCommand<DocumentEditReceipt>({ tx, userId: identity.userId,
      commandId, kind: DOCUMENT_COMMAND.edit, scopeId: owned.id,
      payload: { input, identity, toolCallId }, execute: async () => {
        return { ...await applyDraftEdit(tx, identity, input, toolCallId), executionId: identity.messageId }
      } })
    if (!receipt.replayed) await saveDocumentToolResult(tx, identity.messageId, {
      type: "tool-editProjectDocument", toolCallId, state: "output-available", input, output: receipt.result,
    })
    return receipt.result
  })
}

async function applyDraftEdit(tx: ConversationTransaction, identity: DocumentExecution,
  input: EditDocumentInput, toolCallId: string): Promise<EditDocumentResult> {
  const execution = await lockDocumentExecution(tx, identity)
  if (!execution) notFound()
  const doc = await lockDocument(tx, input.documentId)
  if (!doc?.currentRevisionId) return rejected("DOCUMENT_UNAVAILABLE")
  const draft = await lockDraftForExecution(tx, identity.messageId, input.documentId)
  const blocked = await checkWriteAllowance(tx, identity, execution.project, execution.message)
  if (blocked) return blocked
  if (!draft || draft.id !== input.draftId) return rejected("DRAFT_NOT_FOUND")
  if (draft.status !== "editing") return rejected("DRAFT_CLOSED")
  if (draft.sequence !== input.expectedDraftSequence) return rejected("DRAFT_SEQUENCE_STALE")
  if (!await hasDraftReadReceipt(tx, identity, { documentId: doc.id, readId: input.readId,
    draftId: input.draftId, expectedDraftSequence: input.expectedDraftSequence }))
    return rejected("READ_REQUIRED")
  const patch = applyDocumentEdits(draft.content, input.edits)
  if (!patch.ok) return rejected(patch.code)
  if (!patch.changed) return { status: "no_change", documentId: doc.id, draftId: draft.id, sequence: draft.sequence }
  const sequence = draft.sequence + 1
  const checkpointId = await appendDraftCheckpoint(tx, { draftId: draft.id, documentId: doc.id,
    sequence, kind: "edit", baseRevisionId: draft.baseRevisionId, toolCallId,
    edits: input.edits, content: patch.content })
  await updateDraftWorkingCopy(tx, draft.id, { content: patch.content, sequence })
  return { status: "edited", documentId: doc.id, draftId: draft.id, sequence, checkpointId }
}

export async function commitProjectDocument(
  identity: DocumentExecution, raw: CommitDocumentInput, toolCallId: string
): Promise<CommitDocumentResult> {
  const input = commitDocumentInputSchema.parse(raw)
  return withConversationTransaction(async (tx) => {
    const owned = await findOwnedDocument(tx, identity.userId, input.documentId)
    if (!owned || owned.projectId !== identity.projectId) notFound()
    const commandId = artifactIdForTool(identity.messageId, `commit:${toolCallId}`)
    const receipt = await executeIdempotentCommand<DocumentCommitReceipt>({ tx, userId: identity.userId,
      commandId, kind: DOCUMENT_COMMAND.commit, scopeId: owned.id,
      payload: { input, identity, toolCallId }, execute: async () => {
        return { ...await applyDraftCommit(tx, identity, input, toolCallId, commandId), executionId: identity.messageId }
      } })
    if (!receipt.replayed) await saveDocumentToolResult(tx, identity.messageId, {
      type: "tool-commitProjectDocument", toolCallId, state: "output-available", input, output: receipt.result,
    })
    return receipt.result
  })
}

async function applyDraftCommit(tx: ConversationTransaction, identity: DocumentExecution,
  input: CommitDocumentInput, toolCallId: string, commandId: string): Promise<CommitDocumentResult> {
  const execution = await lockDocumentExecution(tx, identity)
  if (!execution) notFound()
  const doc = await lockDocument(tx, input.documentId)
  if (!doc?.currentRevisionId) return rejected("DOCUMENT_UNAVAILABLE")
  const draft = await lockDraftForExecution(tx, identity.messageId, input.documentId)
  // 已终结草稿先回放最终收据；晚于它的权限/head 变化不能改写已提交事实。
  if (draft && draft.status !== "editing")
    return draft.finalReceipt ?? rejected("DRAFT_CLOSED")
  const blocked = await checkWriteAllowance(tx, identity, execution.project, execution.message)
  if (blocked) return blocked
  if (!draft || draft.id !== input.draftId) return rejected("DRAFT_NOT_FOUND")
  if (draft.sequence !== input.expectedDraftSequence) return rejected("DRAFT_SEQUENCE_STALE")
  if (doc.currentRevisionId !== draft.baseRevisionId)
    return { status: "conflict", code: "DOCUMENT_CHANGED", documentId: doc.id,
      currentRevisionId: doc.currentRevisionId, requiresRead: true }
  const base = await readDocumentRevision(tx, doc.id, draft.baseRevisionId)
  if (!base) return rejected("DOCUMENT_UNAVAILABLE")
  if (draft.content === base.content) {
    const finalReceipt = { status: "unchanged" as const, documentId: doc.id, revisionId: base.id }
    await closeDocumentDraft(tx, draft.id, { status: "unchanged", finalReceipt })
    return finalReceipt
  }
  const result = await appendDocumentRevision(tx, identity, { documentId: doc.id, base,
    content: draft.content, changeSummary: input.changeSummary, edits: [],
    sourceDraftId: draft.id, toolCallId, commandId })
  await closeDocumentDraft(tx, draft.id, { status: "committed",
    committedRevisionId: result.revisionId, finalReceipt: result })
  return result
}

export async function resetProjectDocumentDraft(
  identity: DocumentExecution, raw: ResetDocumentDraftInput, toolCallId: string
): Promise<ResetDocumentDraftResult> {
  const input = resetDocumentDraftInputSchema.parse(raw)
  return withConversationTransaction(async (tx) => {
    const owned = await findOwnedDocument(tx, identity.userId, input.documentId)
    if (!owned || owned.projectId !== identity.projectId) notFound()
    const commandId = artifactIdForTool(identity.messageId, `reset:${toolCallId}`)
    const receipt = await executeIdempotentCommand<DocumentResetReceipt>({ tx, userId: identity.userId,
      commandId, kind: DOCUMENT_COMMAND.reset, scopeId: owned.id,
      payload: { input, identity, toolCallId }, execute: async () => {
        return { ...await applyDraftReset(tx, identity, input, toolCallId), executionId: identity.messageId }
      } })
    if (!receipt.replayed) await saveDocumentToolResult(tx, identity.messageId, {
      type: "tool-resetProjectDocumentDraft", toolCallId, state: "output-available", input, output: receipt.result,
    })
    return receipt.result
  })
}

async function applyDraftReset(tx: ConversationTransaction, identity: DocumentExecution,
  input: ResetDocumentDraftInput, toolCallId: string): Promise<ResetDocumentDraftResult> {
  const execution = await lockDocumentExecution(tx, identity)
  if (!execution) notFound()
  const doc = await lockDocument(tx, input.documentId)
  if (!doc?.currentRevisionId) return rejected("DOCUMENT_UNAVAILABLE")
  const draft = await lockDraftForExecution(tx, identity.messageId, input.documentId)
  const blocked = await checkWriteAllowance(tx, identity, execution.project, execution.message)
  if (blocked) return blocked
  if (!draft || draft.id !== input.draftId) return rejected("DRAFT_NOT_FOUND")
  if (draft.status !== "editing") return rejected("DRAFT_CLOSED")
  if (draft.sequence !== input.expectedDraftSequence) return rejected("DRAFT_SEQUENCE_STALE")
  if (doc.currentRevisionId !== input.revisionId)
    return { status: "conflict", code: "DOCUMENT_CHANGED", documentId: doc.id,
      currentRevisionId: doc.currentRevisionId, requiresRead: true }
  if (await countExecutionConflicts(tx, identity, doc.id, DOCUMENT_COMMAND.commit) > DOCUMENT_LIMITS.conflictRetries)
    return rejected("RETRY_LIMIT")
  if (!await hasRevisionReadReceipt(tx, identity, { documentId: doc.id,
    readId: input.readId, revisionId: input.revisionId }))
    return rejected("READ_REQUIRED")
  const target = await readDocumentRevision(tx, doc.id, input.revisionId)
  if (!target) return rejected("DOCUMENT_UNAVAILABLE")
  const sequence = draft.sequence + 1
  const checkpointId = await appendDraftCheckpoint(tx, { draftId: draft.id, documentId: doc.id,
    sequence, kind: "reset", baseRevisionId: target.id, toolCallId, edits: [], content: target.content })
  await updateDraftWorkingCopy(tx, draft.id, { baseRevisionId: target.id, content: target.content, sequence })
  return { status: "reset", documentId: doc.id, draftId: draft.id, sequence, checkpointId }
}

const documentToolOperations = {
  readProjectDocument: "read",
  editProjectDocument: "edit",
  commitProjectDocument: "commit",
  resetProjectDocumentDraft: "reset",
} as const

/**
 * SDK 在 execute 前拒绝或 execute 抛出时的可恢复留痕。
 * 已存在的操作收据（成功或结构化失败）优先，迟到错误不覆盖已保存事实。
 */
export async function recordDocumentToolCallError(
  identity: DocumentExecution,
  observed: { toolName: string; toolCallId: string; input: unknown }
): Promise<void> {
  const op = documentToolOperations[observed.toolName as keyof typeof documentToolOperations]
  if (!op) return
  try {
    await withConversationTransaction(async (tx) => {
      const [existing] = await tx.select({ result: conversationCommands.result })
        .from(conversationCommands).where(and(
          eq(conversationCommands.userId, identity.userId),
          eq(conversationCommands.id, artifactIdForTool(identity.messageId, `${op}:${observed.toolCallId}`)),
        ))
      if (existing) return
      const parsed = typeof observed.input === "object" && observed.input !== null
        ? z.uuid().safeParse((observed.input as { documentId?: unknown }).documentId) : { success: false as const }
      const scopeId = parsed.success ? parsed.data : identity.messageId
      const receipt = await executeIdempotentCommand<DocumentToolErrorReceipt>({ tx,
        userId: identity.userId,
        commandId: artifactIdForTool(identity.messageId, `tool-error:${observed.toolName}:${observed.toolCallId}`),
        kind: DOCUMENT_COMMAND.toolError, scopeId,
        payload: { toolName: observed.toolName, toolCallId: observed.toolCallId,
          input: observed.input ?? null, identity, source: "stream" },
        execute: async () => ({ status: "rejected", code: "INVALID_TOOL_INPUT",
          toolName: observed.toolName, executionId: identity.messageId }) })
      if (!receipt.replayed) await saveDocumentToolResult(tx, identity.messageId, {
        type: `tool-${observed.toolName}`, toolCallId: observed.toolCallId,
        state: "output-error", input: observed.input, errorText: DOCUMENT_RESULT_COPY.INVALID_TOOL_INPUT,
      } as Parameters<typeof saveDocumentToolResult>[2])
    })
  } catch (error) {
    blockDocumentWrites(identity.messageId)
    logDiagnostic(AI_DIAGNOSTIC_EVENTS.toolException, { toolName: observed.toolName }, error, "error")
  }
}

/** prepareStep 只读提醒：返回本执行未终结的草稿，不触发任何写入。 */
export async function listOpenDraftReminders(identity: DocumentExecution) {
  const drafts = await listEditingDrafts(db, identity.messageId)
  return drafts.map((draft) => ({ documentId: draft.documentId, draftId: draft.id, sequence: draft.sequence }))
}

/** 生命周期终结路径共用：同一事务内关闭本轮 editing 草稿，不反向取 Document 锁。 */
export async function abandonExecutionDocumentDrafts(
  tx: ConversationTransaction, messageId: string,
  closeReason: keyof typeof DOCUMENT_DRAFT_CLOSE_REASON
): Promise<number> {
  return abandonEditingDrafts(tx, messageId, DOCUMENT_DRAFT_CLOSE_REASON[closeReason])
}

export async function getMessageDocumentDrafts(
  userId: string, messageId: string
): Promise<DocumentDraftListDTO> {
  if (!await findOwnedMessage(db, userId, messageId)) notFound()
  return { drafts: await listMessageDraftSummaries(db, messageId) }
}

export async function getDocumentDraftCheckpoints(
  userId: string, draftId: string, cursor?: number
): Promise<DocumentCheckpointListDTO> {
  const draft = await findOwnedDraft(db, userId, draftId)
  if (!draft) notFound()
  return listDraftCheckpoints(db, draft.id, cursor, DOCUMENT_LIMITS.checkpointPageSize)
}

export async function getDocumentDraftCheckpointSnapshot(
  userId: string, draftId: string, sequence: number
): Promise<DocumentCheckpointSnapshotDTO> {
  const draft = await findOwnedDraft(db, userId, draftId)
  if (!draft) notFound()
  const checkpoint = await findDraftCheckpoint(db, draft.id, sequence)
  if (!checkpoint) notFound()
  return checkpoint
}
