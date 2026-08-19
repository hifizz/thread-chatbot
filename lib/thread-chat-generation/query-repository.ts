import { and, desc, eq } from "drizzle-orm"
import type { GenerationSummary } from "@/lib/thread-chat/domain/generation"
import { db } from "@/lib/db"
import { branchGenerations } from "@/lib/db/schema"

export type GenerationRow = typeof branchGenerations.$inferSelect

export async function getGenerationForOwner(
  userId: string,
  generationId: string
): Promise<GenerationRow | null> {
  const [row] = await db
    .select()
    .from(branchGenerations)
    .where(
      and(
        eq(branchGenerations.id, generationId),
        eq(branchGenerations.userId, userId)
      )
    )
  return row ?? null
}

/** 内部执行观察器使用；不构成对用户暴露的数据接口。 */
export async function getGenerationExecutionState(
  generationId: string
): Promise<Pick<GenerationRow, "status" | "isCurrent"> | null> {
  const [row] = await db
    .select({
      status: branchGenerations.status,
      isCurrent: branchGenerations.isCurrent,
    })
    .from(branchGenerations)
    .where(eq(branchGenerations.id, generationId))
  return row ?? null
}

export async function listCurrentGenerationsForTree(
  userId: string,
  treeId: string
): Promise<GenerationRow[]> {
  return db
    .select()
    .from(branchGenerations)
    .where(
      and(
        eq(branchGenerations.userId, userId),
        eq(branchGenerations.treeId, treeId),
        eq(branchGenerations.isCurrent, true)
      )
    )
    .orderBy(desc(branchGenerations.updatedAt))
}

export async function listGenerationsForTree(
  userId: string,
  treeId: string
): Promise<GenerationRow[]> {
  return db
    .select()
    .from(branchGenerations)
    .where(
      and(
        eq(branchGenerations.userId, userId),
        eq(branchGenerations.treeId, treeId)
      )
    )
    .orderBy(desc(branchGenerations.updatedAt))
}

export function toGenerationSummary(row: GenerationRow): GenerationSummary {
  return {
    id: row.id,
    treeId: row.treeId,
    threadId: row.threadId,
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
    attempt: row.attempt,
    isCurrent: row.isCurrent,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    result: row.result,
  }
}
