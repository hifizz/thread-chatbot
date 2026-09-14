import { withConversationTransaction } from "../persistence/transaction"
import type { ThreadChatUIMessage } from "../contracts/ui-message"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { artifacts, conversationCommands, documents, documentRevisions, messages, projects } from "@/lib/db/schema"
import { DOCUMENT_COMMAND, DOCUMENT_LIMITS } from "@/constants/project-documents"
import { type DocumentExecution, type DocumentReadResult, type UpdateDocumentInput, type UpdateDocumentResult, updateDocumentInputSchema } from "../contracts/document"
import { applyDocumentEdits } from "../domain/document-edit"
import { artifactIdForTool } from "../streaming/artifacts"
import { executeIdempotentCommand } from "../persistence/command-repository"
import { documentForArtifact, findOwnedDocument, listOwnedDocuments, readDocumentRevision } from "../persistence/document-repository"
import type { ConversationTransaction } from "../persistence/transaction"
import { notFound } from "./errors"

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
  const rows = await db.select({ id: documentRevisions.id }).from(documentRevisions)
    .where(eq(documentRevisions.documentId, doc.id)).orderBy(desc(documentRevisions.revisionNumber))
  return Promise.all(rows.map(async ({ id }) => (await readDocumentRevision(db, doc.id, id))!))
}
export async function findProjectDocuments(identity: DocumentExecution, input: { query?: string; artifactId?: string }) {
  const candidates = await listOwnedDocuments(db, identity.userId, identity.projectId)
  if (input.artifactId) {
    const id = await documentForArtifact(db, identity.userId, identity.projectId, input.artifactId)
    return candidates.filter((doc) => doc.id === id)
  }
  const query = input.query?.trim().toLocaleLowerCase()
  return query ? candidates.filter((doc) => doc.title.toLocaleLowerCase().includes(query)) : candidates
}

/** Project SHARE 与归档互斥但允许不同文档并行；消息行锁与 Stop 协调。 */
async function lockExecution(tx: ConversationTransaction, identity: DocumentExecution) {
  const [project] = await tx.select().from(projects)
    .where(and(eq(projects.id, identity.projectId), eq(projects.userId, identity.userId))).for("share")
  if (!project) notFound()
  const [message] = await tx.select().from(messages).where(and(eq(messages.id, identity.messageId),
    eq(messages.projectId, identity.projectId), eq(messages.threadId, identity.threadId))).for("update")
  return { project, message }
}
export async function readProjectDocument(identity: DocumentExecution, input: { documentId: string; revisionId?: string }, toolCallId: string): Promise<DocumentReadResult> {
  return withConversationTransaction(async (tx) => {
    const { message } = await lockExecution(tx, identity)
    if (!message || message.role !== "assistant" || message.status !== "generating" || message.stopRequestedAt || message.supersededAt)
      throw new Error("EXECUTION_INACTIVE")
    const doc = await findOwnedDocument(tx, identity.userId, input.documentId)
    if (!doc?.currentRevisionId || doc.projectId !== identity.projectId) notFound()
    const readId = artifactIdForTool(identity.messageId, `read:${toolCallId}`)
    const receipt = await executeIdempotentCommand({ tx, userId: identity.userId, commandId: readId,
      kind: DOCUMENT_COMMAND.read, scopeId: doc.id, payload: { ...input, identity }, execute: async () => {
        const revision = await readDocumentRevision(tx, doc.id, input.revisionId ?? doc.currentRevisionId!)
        if (!revision) notFound()
        return { document: { id: doc.id, projectId: doc.projectId, currentRevisionId: doc.currentRevisionId!,
          title: revision.title, archivedAt: doc.archivedAt?.toISOString() ?? null },
          revision, readId, isCurrent: revision.id === doc.currentRevisionId,
          executionId: identity.messageId }
      } })
    if (!receipt.replayed) await saveToolResult(tx, identity.messageId, {
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
    const receipt = await executeIdempotentCommand<UpdateDocumentResult>({ tx, userId: identity.userId,
      commandId: artifactIdForTool(identity.messageId, `update:${toolCallId}`), kind: DOCUMENT_COMMAND.update,
      scopeId: owned.id, payload: { input, identity, toolCallId }, execute: async () => {
        const { project, message } = await lockExecution(tx, identity)
        const [doc] = await tx.select().from(documents).where(eq(documents.id, owned.id)).for("update")
        if (!doc?.currentRevisionId) return { status: "rejected", code: "DOCUMENT_UNAVAILABLE" }
        if (process.env.THREAD_CHAT_DOCUMENT_WRITES === "false") return { status: "rejected", code: "WRITES_DISABLED" }
        if (project.archivedAt || doc.archivedAt) return { status: "rejected", code: "DOCUMENT_READ_ONLY" }
        if (!message || message.role !== "assistant" || message.status !== "generating" || message.stopRequestedAt || message.supersededAt)
          return { status: "rejected", code: "EXECUTION_INACTIVE" }
        const previous = await tx.select({ result: conversationCommands.result }).from(conversationCommands)
          .where(and(eq(conversationCommands.userId, identity.userId), eq(conversationCommands.scopeId, doc.id), eq(conversationCommands.kind, DOCUMENT_COMMAND.update)))
        const conflicts = previous.filter(({ result }) => {
          const r = result as { status?: string; executionId?: string }
          return r.status === "conflict" && r.executionId === identity.messageId
        }).length
        if (conflicts > DOCUMENT_LIMITS.conflictRetries) return { status: "rejected", code: "RETRY_LIMIT" }
        if (doc.currentRevisionId !== input.expectedRevisionId)
          return { status: "conflict", code: "DOCUMENT_CHANGED", documentId: doc.id,
            currentRevisionId: doc.currentRevisionId, requiresRead: true, executionId: identity.messageId }
        const [read] = await tx.select().from(conversationCommands).where(and(
          eq(conversationCommands.userId, identity.userId), eq(conversationCommands.id, input.readId),
          eq(conversationCommands.kind, DOCUMENT_COMMAND.read), eq(conversationCommands.scopeId, doc.id)))
        const readResult = read?.result as (DocumentReadResult & { executionId: string }) | undefined
        if (!readResult || readResult.executionId !== identity.messageId || readResult.revision?.id !== input.expectedRevisionId)
          return { status: "rejected", code: "READ_REQUIRED" }
        const base = await readDocumentRevision(tx, doc.id, doc.currentRevisionId)
        if (!base) return { status: "rejected", code: "DOCUMENT_UNAVAILABLE" }
        const patch = applyDocumentEdits(base.content, input.edits)
        if (!patch.ok) return { status: "rejected", code: patch.code }
        if (!patch.changed) return { status: "unchanged", documentId: doc.id, revisionId: base.id }
        const artifactId = artifactIdForTool(identity.messageId, toolCallId)
        const revisionId = crypto.randomUUID()
        await tx.insert(artifacts).values({ id: artifactId, projectId: identity.projectId,
          threadId: identity.threadId, sourceMessageId: identity.messageId, kind: "markdown",
          title: base.title, content: patch.content, metadata: { toolCallId, documentId: doc.id, revisionId } })
        await tx.insert(documentRevisions).values({ id: revisionId, documentId: doc.id, projectId: doc.projectId,
          revisionNumber: base.revisionNumber + 1, parentRevisionId: base.id, artifactId,
          changeSummary: input.changeSummary, edits: input.edits, actorUserId: identity.userId,
          commandId: artifactIdForTool(identity.messageId, `update:${toolCallId}`),
          executionId: identity.messageId, toolCallId })
        await tx.update(documents).set({ currentRevisionId: revisionId }).where(eq(documents.id, doc.id))
        return { status: "committed", documentId: doc.id, previousRevisionId: base.id,
          revisionId, artifactId, changeSummary: input.changeSummary }
      } })
    if (!receipt.replayed) await saveToolResult(tx, identity.messageId, {
      type: "tool-updateProjectDocument", toolCallId, state: "output-available", input, output: receipt.result,
    })
    return receipt.result
  })
}

async function saveToolResult(tx: ConversationTransaction, messageId: string, part: ThreadChatUIMessage["parts"][number]) {
  await tx.update(messages).set({ documentToolParts: sql`${messages.documentToolParts} || ${JSON.stringify([part])}::jsonb` })
    .where(and(eq(messages.id, messageId), eq(messages.status, "generating")))
}
