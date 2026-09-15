import { listProjectArtifactRows } from "../../persistence/artifact-repository"
import { toArtifactSummaryDTO } from "../../persistence/mappers"
import { findOwnedProject } from "../../persistence/project-repository"
import type { ProjectDocumentsDTO } from "../../contracts/document"
import { isActiveDocumentExecution } from "../../domain/documents/execution"
import { lockDocumentExecution, countExecutionConflicts, hasDocumentReadReceipt, saveDocumentToolResult,
  type DocumentReadReceipt, type DocumentUpdateReceipt } from "../../persistence/documents/commands"
import { lockDocument, appendDocumentRevision } from "../../persistence/documents/writes"
import { documentWritesEnabled } from "./configuration"
import { type ConversationTransaction, withConversationTransaction } from "../../persistence/transaction"
import { db } from "@/lib/db"
import { DOCUMENT_COMMAND, DOCUMENT_LIMITS } from "@/constants/project-documents"
import { type DocumentExecution, type DocumentReadResult, type UpdateDocumentInput, type UpdateDocumentResult, updateDocumentInputSchema } from "../../contracts/document"
import { applyDocumentEdits } from "../../domain/documents/edit"
import { artifactIdForTool } from "../../domain/tool-identity"
import { executeIdempotentCommand } from "../../persistence/command-repository"
import { documentForArtifact, findOwnedDocument, listOwnedDocuments, readDocumentRevision, listDocumentHistory } from "../../persistence/documents/queries"
import { notFound } from "../errors"

export async function getProjectDocument(userId: string, documentId: string, revisionId?: string) {
  const doc = await findOwnedDocument(db, userId, documentId)
  if (!doc?.currentRevisionId) notFound()
  const revision = await readDocumentRevision(db, doc.id, revisionId ?? doc.currentRevisionId)
  if (!revision) notFound()
  return { document: { id: doc.id, projectId: doc.projectId, currentRevisionId: doc.currentRevisionId,
    title: revision.title, archivedAt: doc.archivedAt?.toISOString() ?? null }, revision }
}
export async function getDocumentHistory(userId: string, documentId: string) {
  const doc = await findOwnedDocument(db, userId, documentId)
  if (!doc) notFound()
  return listDocumentHistory(db, doc.id)
}
export async function findProjectDocuments(identity: DocumentExecution, input: { query?: string; artifactId?: string }) {
  const documentId = input.artifactId
    ? await documentForArtifact(db, identity.userId, identity.projectId, input.artifactId) : undefined
  if (input.artifactId && !documentId) return []
  const candidates = await listOwnedDocuments(db, identity.userId, identity.projectId, documentId ?? undefined)
  const query = input.query?.trim().toLocaleLowerCase()
  return query ? candidates.filter((doc) => doc.title.toLocaleLowerCase().includes(query)) : candidates
}

export async function readProjectDocument(identity: DocumentExecution, input: { documentId: string; revisionId?: string }, toolCallId: string): Promise<DocumentReadResult> {
  return withConversationTransaction(async (tx) => {
    const execution = await lockDocumentExecution(tx, identity)
    if (!execution) notFound()
    const { message } = execution
    if (!isActiveDocumentExecution(message))
      throw new Error("EXECUTION_INACTIVE")
    const doc = await findOwnedDocument(tx, identity.userId, input.documentId)
    if (!doc?.currentRevisionId || doc.projectId !== identity.projectId) notFound()
    const readId = artifactIdForTool(identity.messageId, `read:${toolCallId}`)
    const receipt = await executeIdempotentCommand<DocumentReadReceipt>({ tx, userId: identity.userId, commandId: readId,
      kind: DOCUMENT_COMMAND.read, scopeId: doc.id, payload: { ...input, identity }, execute: async () => {
        const revision = await readDocumentRevision(tx, doc.id, input.revisionId ?? doc.currentRevisionId!)
        if (!revision) notFound()
        return { document: { id: doc.id, projectId: doc.projectId, currentRevisionId: doc.currentRevisionId!,
          title: revision.title, archivedAt: doc.archivedAt?.toISOString() ?? null },
          revision, readId, isCurrent: revision.id === doc.currentRevisionId,
          executionId: identity.messageId }
      } })
    if (!receipt.replayed) await saveDocumentToolResult(tx, identity.messageId, {
      type: "tool-readProjectDocument", toolCallId, state: "output-available", input, output: receipt.result,
    })
    return receipt.result
  })
}

export async function updateProjectDocument(identity: DocumentExecution, raw: UpdateDocumentInput, toolCallId: string): Promise<UpdateDocumentResult> {
  const input = updateDocumentInputSchema.parse(raw)
  return withConversationTransaction(async (tx) => {
    const owned = await findOwnedDocument(tx, identity.userId, input.documentId)
    if (!owned || owned.projectId !== identity.projectId) notFound()
    // 幂等命令预留先于业务锁，和现有 Stop/归档命令保持顺序一致。
    const commandId = artifactIdForTool(identity.messageId, `update:${toolCallId}`)
    const receipt = await executeIdempotentCommand<DocumentUpdateReceipt>({ tx, userId: identity.userId,
      commandId, kind: DOCUMENT_COMMAND.update,
      scopeId: owned.id, payload: { input, identity, toolCallId }, execute: async () => {
        return { ...await commitDocumentUpdate(tx, identity, input, toolCallId, commandId), executionId: identity.messageId }
      } })
    if (!receipt.replayed) await saveDocumentToolResult(tx, identity.messageId, {
      type: "tool-updateProjectDocument", toolCallId, state: "output-available", input, output: receipt.result,
    })
    return receipt.result
  })
}


async function commitDocumentUpdate(tx: ConversationTransaction, identity: DocumentExecution,
  input: UpdateDocumentInput, toolCallId: string, commandId: string): Promise<UpdateDocumentResult> {
  const execution = await lockDocumentExecution(tx, identity)
  if (!execution) notFound()
  const { project, message } = execution
  const doc = await lockDocument(tx, input.documentId)
  if (!doc?.currentRevisionId) return { status: "rejected", code: "DOCUMENT_UNAVAILABLE" }
  if (!documentWritesEnabled()) return { status: "rejected", code: "WRITES_DISABLED" }
  if (project.archivedAt || doc.archivedAt) return { status: "rejected", code: "DOCUMENT_READ_ONLY" }
  if (!isActiveDocumentExecution(message))
    return { status: "rejected", code: "EXECUTION_INACTIVE" }
  const conflicts = await countExecutionConflicts(tx, identity, doc.id)
  if (conflicts > DOCUMENT_LIMITS.conflictRetries) return { status: "rejected", code: "RETRY_LIMIT" }
  if (doc.currentRevisionId !== input.expectedRevisionId)
    return { status: "conflict", code: "DOCUMENT_CHANGED", documentId: doc.id,
      currentRevisionId: doc.currentRevisionId, requiresRead: true }
  if (!await hasDocumentReadReceipt(tx, identity, input))
    return { status: "rejected", code: "READ_REQUIRED" }
  const base = await readDocumentRevision(tx, doc.id, doc.currentRevisionId)
  if (!base) return { status: "rejected", code: "DOCUMENT_UNAVAILABLE" }
  const patch = applyDocumentEdits(base.content, input.edits)
  if (!patch.ok) return { status: "rejected", code: patch.code }
  if (!patch.changed) return { status: "unchanged", documentId: doc.id, revisionId: base.id }
  return appendDocumentRevision(tx, identity, input, base, patch.content, toolCallId, commandId)
}

export async function getProjectDocuments(userId: string, projectId: string): Promise<ProjectDocumentsDTO> {
  if (!await findOwnedProject(db, userId, projectId)) notFound()
  const [documents, artifacts] = await Promise.all([listOwnedDocuments(db, userId, projectId), listProjectArtifactRows(db, projectId)])
  return { documents, artifacts: artifacts.map(toArtifactSummaryDTO) }
}
