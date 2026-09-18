import { and, desc, eq, gt, isNull, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { shares } from "@/lib/db/schema"
import type {
  ShareDTO,
  ShareStatus,
} from "@/lib/thread-chat/sharing/contracts"
import type {
  ConversationExecutor,
  ConversationTransaction,
} from "@/lib/thread-chat/persistence/transaction"

export type ShareRow = typeof shares.$inferSelect

/** 快照必须读取单一一致性视图；默认 READ COMMITTED 可能拼贴不同时点状态。 */
export async function withSnapshotTransaction<T>(
  execute: (tx: ConversationTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(execute, { isolationLevel: "repeatable read" })
}

function shareStatus(row: ShareRow, now: Date): ShareStatus {
  if (row.revokedAt !== null) return "revoked"
  if (row.expiresAt !== null && row.expiresAt <= now) return "expired"
  return "active"
}

export function toShareDTO(row: ShareRow, now = new Date()): ShareDTO {
  return {
    id: row.id,
    resourceType: row.resourceType as ShareDTO["resourceType"],
    resourceId: row.resourceId,
    token: row.token,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    status: shareStatus(row, now),
  }
}

export async function insertShare(
  tx: ConversationTransaction,
  value: Omit<ShareRow, "createdAt" | "revokedAt" | "schemaVersion"> & {
    schemaVersion?: number
  }
): Promise<ShareRow> {
  const [row] = await tx.insert(shares).values(value).returning()
  return row
}

/** 匿名读路径：不按 owner 过滤，有效性由应用层统一判定。 */
export async function findShareByToken(
  executor: ConversationExecutor,
  token: string
): Promise<ShareRow | null> {
  const [row] = await executor
    .select()
    .from(shares)
    .where(eq(shares.token, token))
    .limit(1)
  return row ?? null
}

export async function listOwnedShares(
  executor: ConversationExecutor,
  userId: string,
  resourceType: "project" | "document",
  resourceId: string
): Promise<ShareRow[]> {
  return executor
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.ownerId, userId),
        eq(shares.resourceType, resourceType),
        eq(shares.resourceId, resourceId)
      )
    )
    .orderBy(desc(shares.createdAt))
}

/** 有效分享：未撤销且未过期。同一资源同时只允许一条（创建/撤销前后端双重约束）。 */
export async function findActiveShare(
  executor: ConversationExecutor,
  userId: string,
  resourceType: "project" | "document",
  resourceId: string,
  now = new Date()
): Promise<ShareRow | null> {
  const [row] = await executor
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.ownerId, userId),
        eq(shares.resourceType, resourceType),
        eq(shares.resourceId, resourceId),
        isNull(shares.revokedAt),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, now))
      )
    )
    .limit(1)
  return row ?? null
}

export async function findOwnedShare(
  executor: ConversationExecutor,
  userId: string,
  shareId: string
): Promise<ShareRow | null> {
  const [row] = await executor
    .select()
    .from(shares)
    .where(and(eq(shares.id, shareId), eq(shares.ownerId, userId)))
    .limit(1)
  return row ?? null
}

/** 幂等撤销：已撤销的行原样返回。 */
export async function revokeShareRow(
  executor: ConversationExecutor,
  row: ShareRow,
  now: Date
): Promise<ShareRow> {
  if (row.revokedAt !== null) return row
  const [updated] = await executor
    .update(shares)
    .set({ revokedAt: now })
    .where(eq(shares.id, row.id))
    .returning()
  return updated ?? { ...row, revokedAt: now }
}
