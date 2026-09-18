import { randomBytes, randomUUID } from "node:crypto"
import {
  SHARE_EXPIRY_DEFAULT,
  SHARE_TOKEN_BYTES,
  shareExpiryDays,
} from "@/constants/sharing"
import type {
  CreateShareCommand,
  CreateShareResult,
  ListSharesQuery,
  PublicShareResponse,
  PublicSnapshot,
  ShareDTO,
  ShareExpiryInput,
} from "@/lib/thread-chat/sharing/contracts"
import {
  buildDocumentSnapshot,
  buildProjectSnapshot,
  ShareSnapshotError,
} from "@/lib/thread-chat/sharing/snapshot"
import { db } from "@/lib/db"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import { listProjectArtifactRows } from "@/lib/thread-chat/persistence/artifact-repository"
import {
  findOwnedDocument,
  listOwnedDocuments,
  readDocumentRevision,
} from "@/lib/thread-chat/persistence/documents/queries"
import { listProjectMessageRows } from "@/lib/thread-chat/persistence/message-repository"
import { findOwnedProject } from "@/lib/thread-chat/persistence/project-repository"
import {
  findOwnedShare,
  findShareByToken,
  insertShare,
  listOwnedShares,
  revokeShareRow,
  toShareDTO,
  withSnapshotTransaction,
} from "@/lib/thread-chat/persistence/share-repository"
import { listProjectThreadRows } from "@/lib/thread-chat/persistence/thread-repository"
import {
  toArtifactDTO,
  toMessageDTO,
  toProjectDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"
import { registerOwnedProjectDocuments } from "./documents/register-existing"
import { ConversationApplicationError, notFound, stateConflict } from "./errors"

function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url")
}

function expiryDate(expiresIn: ShareExpiryInput | undefined): Date | null {
  const days = shareExpiryDays(expiresIn ?? SHARE_EXPIRY_DEFAULT)
  return days === null ? null : new Date(Date.now() + days * 86_400_000)
}

function shareScopeId(command: CreateShareCommand): string {
  return command.resourceType === "project"
    ? `project:${command.projectId}`
    : `document:${command.documentId}`
}

async function createProjectShare(
  tx: ConversationTransaction,
  userId: string,
  command: Extract<CreateShareCommand, { resourceType: "project" }>
): Promise<ShareDTO> {
  const project = await findOwnedProject(tx, userId, command.projectId)
  if (!project) notFound()
  const [threadRows, messageRows, artifactRows, documentItems] =
    await Promise.all([
      listProjectThreadRows(tx, project.id),
      listProjectMessageRows(tx, project.id),
      listProjectArtifactRows(tx, project.id),
      listOwnedDocuments(tx, userId, project.id),
    ])
  const root = threadRows.find((thread) => thread.parentId === null)
  if (!root) stateConflict("Project 缺少根 Thread")
  const createdAt = new Date().toISOString()
  const snapshot = buildProjectSnapshot({
    project: toProjectDTO(project, root.id),
    threads: threadRows.map(toThreadDTO),
    messages: messageRows.map(toMessageDTO),
    artifacts: artifactRows.map(toArtifactDTO),
    documents: documentItems,
    layout: command.layout,
    createdAt,
  })
  const row = await insertShare(tx, {
    id: randomUUID(),
    token: generateShareToken(),
    ownerId: userId,
    sourceProjectId: project.id,
    resourceType: "project",
    resourceId: project.id,
    snapshot,
    expiresAt: expiryDate(command.expiresIn),
  })
  return toShareDTO(row)
}

async function createDocumentShare(
  tx: ConversationTransaction,
  userId: string,
  command: Extract<CreateShareCommand, { resourceType: "document" }>
): Promise<ShareDTO> {
  const document = await findOwnedDocument(tx, userId, command.documentId)
  if (!document || document.currentRevisionId === null) notFound()
  const revision = await readDocumentRevision(
    tx,
    document.id,
    document.currentRevisionId
  )
  if (!revision) stateConflict("文档当前版本不可用")
  const snapshot = buildDocumentSnapshot({
    document: {
      id: document.id,
      title: revision.title,
      currentRevisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      currentArtifactId: revision.artifactId,
    },
    revisionCreatedAt: revision.createdAt,
    content: revision.content,
    createdAt: new Date().toISOString(),
  })
  const row = await insertShare(tx, {
    id: randomUUID(),
    token: generateShareToken(),
    ownerId: userId,
    sourceProjectId: document.projectId,
    resourceType: "document",
    resourceId: document.id,
    snapshot,
    expiresAt: expiryDate(command.expiresIn),
  })
  return toShareDTO(row)
}

export async function createShare(
  userId: string,
  command: CreateShareCommand
): Promise<{ replayed: boolean; result: CreateShareResult }> {
  // 未注册文档回填放快照事务之外（与 bootstrap 同一时序），REPEATABLE READ 内只读一致视图。
  if (command.resourceType === "project")
    await registerOwnedProjectDocuments(userId, command.projectId)
  try {
    const { replayed, result } = await withSnapshotTransaction((tx) =>
      executeIdempotentCommand({
        tx,
        userId,
        commandId: command.commandId,
        kind: "share-create",
        scopeId: shareScopeId(command),
        payload: command,
        execute: () =>
          command.resourceType === "project"
            ? createProjectShare(tx, userId, command)
            : createDocumentShare(tx, userId, command),
      })
    )
    return { replayed, result: { share: result } }
  } catch (error) {
    if (error instanceof ShareSnapshotError)
      throw new ConversationApplicationError(
        error.code === "SNAPSHOT_TOO_LARGE" ? "VALIDATION_ERROR" : "STATE_CONFLICT",
        error.message
      )
    throw error
  }
}

export async function listShares(
  userId: string,
  query: ListSharesQuery
): Promise<ShareDTO[]> {
  const rows = await listOwnedShares(
    db,
    userId,
    query.resourceType,
    query.resourceId
  )
  return rows.map((row) => toShareDTO(row))
}

export async function revokeShare(
  userId: string,
  shareId: string
): Promise<ShareDTO> {
  const row = await findOwnedShare(db, userId, shareId)
  if (!row) notFound()
  return toShareDTO(await revokeShareRow(db, row, new Date()))
}

/** 匿名读：无效/过期/撤销统一返回 null，不区分原因、不泄露资源信息。 */
export async function getPublicShare(
  token: string
): Promise<PublicShareResponse | null> {
  const row = await findShareByToken(db, token)
  if (!row) return null
  const now = new Date()
  if (row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= now))
    return null
  const snapshot = row.snapshot as PublicSnapshot
  if (snapshot?.schemaVersion !== 1) return null
  return {
    resourceType: row.resourceType as PublicShareResponse["resourceType"],
    createdAt: row.createdAt.toISOString(),
    snapshot,
  }
}
