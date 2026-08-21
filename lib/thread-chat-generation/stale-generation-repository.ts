import { and, eq, inArray, lt } from "drizzle-orm"
import type { GenerationResultV1 } from "@/lib/thread-chat/domain/generation"
import { generationResultV1Schema } from "@/lib/thread-chat/contracts/generation-result"
import {
  ACTIVE_GENERATION_STATUSES,
  GENERATION_ERRORS,
  GENERATION_LEASE_MS,
  GENERATION_RESULT_VERSION,
} from "@/constants/generation"
import { db } from "@/lib/db"
import { branchGenerations } from "@/lib/db/schema"
import {
  getGenerationForOwner,
  type GenerationRow,
} from "@/lib/thread-chat-generation/query-repository"

function staleFailureResult(row: GenerationRow): GenerationResultV1 {
  const partial = row.turnSnapshot.assistantMessage
  return generationResultV1Schema.parse({
    version: GENERATION_RESULT_VERSION,
    generationId: row.id,
    text: partial.text,
    status: "error",
    error: GENERATION_ERRORS.backgroundInterrupted,
    artifactIds: partial.artifactIds ?? [],
    artifacts: {},
    webResearch: partial.webResearch,
    webResearchTextOffset: partial.webResearchTextOffset,
    researchRoute: partial.researchRoute,
    researchPlan: partial.researchPlan,
  })
}

/** 将一棵 owner tree 内 lease 过期的活跃 generation 原子收敛为 failed。 */
export async function failStaleGenerationsForTree(
  userId: string,
  treeId: string,
  now = new Date()
): Promise<number> {
  const staleBefore = new Date(now.getTime() - GENERATION_LEASE_MS)
  const staleRows = await db
    .select()
    .from(branchGenerations)
    .where(
      and(
        eq(branchGenerations.userId, userId),
        eq(branchGenerations.treeId, treeId),
        inArray(branchGenerations.status, ACTIVE_GENERATION_STATUSES),
        lt(branchGenerations.heartbeatAt, staleBefore)
      )
    )

  let changed = 0
  for (const row of staleRows) {
    const [updated] = await db
      .update(branchGenerations)
      .set({
        status: "failed",
        result: staleFailureResult(row),
        error: GENERATION_ERRORS.backgroundInterrupted,
        billingStatus: "usage_unavailable",
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(branchGenerations.id, row.id),
          inArray(branchGenerations.status, ACTIVE_GENERATION_STATUSES),
          lt(branchGenerations.heartbeatAt, staleBefore)
        )
      )
      .returning({ id: branchGenerations.id })
    if (updated) changed++
  }
  return changed
}

export async function failStaleGenerationForOwner(
  userId: string,
  generationId: string,
  now = new Date()
): Promise<GenerationRow | null> {
  const row = await getGenerationForOwner(userId, generationId)
  if (!row) return null
  if (
    ACTIVE_GENERATION_STATUSES.includes(
      row.status as (typeof ACTIVE_GENERATION_STATUSES)[number]
    ) &&
    row.heartbeatAt.getTime() < now.getTime() - GENERATION_LEASE_MS
  ) {
    await failStaleGenerationsForTree(userId, row.treeId, now)
    return getGenerationForOwner(userId, generationId)
  }
  return row
}
