import { randomBytes, randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { projects, threads, messages, artifacts, shares } from "@/lib/db/schema"
import { SHARE_TOKEN_PATTERN } from "@/constants/sharing"
import { executeIdempotentCommand } from "../persistence/command-repository"
import { findActiveShare, listOwnedShareRows } from "../persistence/share-repository"
import { buildArtifactSnapshot, buildProjectSnapshot } from "../sharing/snapshot"
import { createShareSchema, expiryDate, isShareActive, publicSnapshotSchema, type CreateShareInput, type ShareSummary } from "../sharing/contracts"
import { notFound } from "./errors"

function summary(row: { id: string; token: string; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null }, now = new Date()): ShareSummary {
  return { id: row.id, path: `/share/${row.token}`, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null, status: row.revokedAt ? "revoked" : isShareActive(row, now) ? "active" : "expired" }
}
export async function createShare(userId: string, value: CreateShareInput) {
  const input = createShareSchema.parse(value)
  return db.transaction(async (tx) => executeIdempotentCommand({
    tx, userId, commandId: input.commandId, kind: "create-share", scopeId: input.resourceId, payload: input,
    execute: async () => {
      let projectId = input.resourceId
      const [artifact] = input.resourceType === "artifact" ? await tx.select().from(artifacts).where(eq(artifacts.id, input.resourceId)).limit(1) : []
      if (input.resourceType === "artifact") { if (!artifact) notFound(); projectId = artifact.projectId }
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1)
      if (!project) notFound()
      let snapshot
      if (input.resourceType === "project") {
        const threadRows = await tx.select().from(threads).where(eq(threads.projectId, projectId))
        const messageRows = await tx.select().from(messages).where(eq(messages.projectId, projectId))
        const artifactRows = await tx.select().from(artifacts).where(eq(artifacts.projectId, projectId))
        snapshot = buildProjectSnapshot(project, threadRows, messageRows, artifactRows, input.layout)
      } else {
        if (!artifact) notFound()
        const [thread] = await tx.select().from(threads).where(eq(threads.id, artifact.threadId)).limit(1)
        const [source] = await tx.select().from(messages).where(eq(messages.id, artifact.sourceMessageId)).limit(1)
        if (!thread || !source) notFound()
        snapshot = buildArtifactSnapshot(project, thread, source, artifact)
      }
      const now = new Date()
      const [row] = await tx.insert(shares).values({ id: randomUUID(), token: randomBytes(24).toString("base64url"), ownerId: userId, sourceProjectId: projectId, resourceType: input.resourceType, resourceId: input.resourceId, snapshot, createdAt: now, expiresAt: expiryDate(input.expiry, now) }).returning()
      return summary(row, now)
    },
  }), { isolationLevel: "repeatable read" })
}
export async function listShares(userId: string, resourceType: "project" | "artifact", resourceId: string) {
  return (await listOwnedShareRows(db, userId, resourceType, resourceId)).map((row) => summary(row))
}
export async function revokeShare(userId: string, id: string) {
  const [row] = await db.update(shares).set({ revokedAt: sql`coalesce(${shares.revokedAt}, now())` }).where(and(eq(shares.id, id), eq(shares.ownerId, userId))).returning({ id: shares.id })
  if (!row) notFound()
  return { id: row.id }
}
/** 匿名入口只读 shares；不能回查来源或启动会话运行时。 */
export async function readPublicShare(token: string) {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null
  const row = await findActiveShare(db, token, new Date())
  if (!row) return null
  const parsed = publicSnapshotSchema.safeParse(row.snapshot)
  if (!parsed.success) return null
  return { snapshot: parsed.data, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null }
}
