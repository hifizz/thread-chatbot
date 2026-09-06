import { and, desc, eq, isNull, or, gt } from "drizzle-orm"
import { shares } from "@/lib/db/schema"
import type { ConversationExecutor } from "./transaction"

export function listOwnedShareRows(tx: ConversationExecutor, ownerId: string, resourceType: "project" | "artifact", resourceId: string) {
  return tx.select({ id: shares.id, token: shares.token, createdAt: shares.createdAt, expiresAt: shares.expiresAt, revokedAt: shares.revokedAt }).from(shares)
    .where(and(eq(shares.ownerId, ownerId), eq(shares.resourceType, resourceType), eq(shares.resourceId, resourceId))).orderBy(desc(shares.createdAt))
}
export async function findActiveShare(tx: ConversationExecutor, token: string, now: Date) {
  const [row] = await tx.select({ snapshot: shares.snapshot, createdAt: shares.createdAt, expiresAt: shares.expiresAt }).from(shares)
    .where(and(eq(shares.token, token), isNull(shares.revokedAt), or(isNull(shares.expiresAt), gt(shares.expiresAt, now)))).limit(1)
  return row ?? null
}
