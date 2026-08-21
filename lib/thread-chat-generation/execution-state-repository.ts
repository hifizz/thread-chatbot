import { and, eq, inArray, sql } from "drizzle-orm"
import { ACTIVE_GENERATION_STATUSES } from "@/constants/generation"
import { db } from "@/lib/db"
import { branchGenerations } from "@/lib/db/schema"
import type { GenerationRow } from "@/lib/thread-chat-generation/query-repository"

/** Owner-scoped running → stop_requested transition; terminal states remain idempotent. */
export async function requestGenerationStop(
  userId: string,
  generationId: string
): Promise<GenerationRow | null> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select ${branchGenerations.id}
      from ${branchGenerations}
      where ${branchGenerations.id} = ${generationId}
        and ${branchGenerations.userId} = ${userId}
      for update
    `)
    if (locked.length === 0) return null

    const now = new Date()
    const [updated] = await tx
      .update(branchGenerations)
      .set({
        status: "stop_requested",
        stopRequestedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(branchGenerations.id, generationId),
          eq(branchGenerations.userId, userId),
          eq(branchGenerations.status, "running")
        )
      )
      .returning()
    if (updated) return updated

    const [current] = await tx
      .select()
      .from(branchGenerations)
      .where(
        and(
          eq(branchGenerations.id, generationId),
          eq(branchGenerations.userId, userId)
        )
      )
    return current ?? null
  })
}

/** 延长 active generation 的 lease；终态调用是无副作用的 no-op。 */
export async function heartbeatGeneration(generationId: string) {
  const now = new Date()
  await db
    .update(branchGenerations)
    .set({ heartbeatAt: now, updatedAt: now })
    .where(
      and(
        eq(branchGenerations.id, generationId),
        inArray(branchGenerations.status, ACTIVE_GENERATION_STATUSES)
      )
    )
}
