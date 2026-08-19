import { and, desc, eq, inArray, lt, max, sql } from "drizzle-orm"
import type { ThreadTreeState } from "@/app/thread-chat/core/types"
import type {
  GenerationResultV1,
  GenerationStatus,
  GenerationSummary,
  GenerationTurnIdentity,
  GenerationTurnSnapshot,
} from "@/app/thread-chat/generation/types"
import {
  ACTIVE_GENERATION_STATUSES,
  GENERATION_ERRORS,
  GENERATION_LEASE_MS,
} from "@/constants/generation"
import { db } from "@/lib/db"
import { branchGenerations, branchTrees } from "@/lib/db/schema"

export class GenerationRepositoryError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "invalid_turn",
    message: string
  ) {
    super(message)
    this.name = "GenerationRepositoryError"
  }
}

type StartGenerationInput = GenerationTurnIdentity & {
  userId: string
  modelId: string
}

type GenerationRow = typeof branchGenerations.$inferSelect

export type StartGenerationResult = {
  created: boolean
  generation: GenerationRow
}

function isThreadTreeState(value: unknown): value is ThreadTreeState {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<ThreadTreeState>
  return (
    typeof candidate.threads === "object" &&
    candidate.threads !== null &&
    typeof candidate.artifacts === "object" &&
    candidate.artifacts !== null &&
    Array.isArray(candidate.artifactOrder)
  )
}

function verifyTurn(
  stateValue: unknown,
  input: GenerationTurnIdentity
): GenerationTurnSnapshot {
  if (!isThreadTreeState(stateValue)) {
    throw new GenerationRepositoryError(
      "invalid_turn",
      "已保存的分支树状态无效"
    )
  }

  const thread = stateValue.threads[input.threadId]
  if (!thread) {
    throw new GenerationRepositoryError("invalid_turn", "目标会话不存在")
  }

  const assistantMessageIndex = thread.messages.findIndex(
    (message) => message.id === input.assistantMessageId
  )
  const userMessageIndex = thread.messages.findIndex(
    (message) => message.id === input.userMessageId
  )
  const assistantMessage = thread.messages[assistantMessageIndex]
  const userMessage = thread.messages[userMessageIndex]

  if (
    assistantMessageIndex < 1 ||
    userMessageIndex !== assistantMessageIndex - 1 ||
    userMessage?.role !== "user" ||
    assistantMessage?.role !== "assistant" ||
    assistantMessage.generationId !== input.generationId
  ) {
    throw new GenerationRepositoryError(
      "invalid_turn",
      "生成目标与已持久化的消息占位不一致"
    )
  }

  return {
    threadId: input.threadId,
    assistantMessageIndex,
    userMessage: structuredClone(userMessage),
    assistantMessage: structuredClone(assistantMessage),
  }
}

function assertReplayMatches(row: GenerationRow, input: StartGenerationInput) {
  if (
    row.treeId !== input.treeId ||
    row.threadId !== input.threadId ||
    row.userMessageId !== input.userMessageId ||
    row.assistantMessageId !== input.assistantMessageId ||
    row.modelId !== input.modelId
  ) {
    throw new GenerationRepositoryError(
      "conflict",
      "generation id 已被其他生成请求使用"
    )
  }
}

/**
 * 严格 start transaction。只有它返回 created=true 时调用方才可以发起付费模型请求；
 * 同 generation id 重放返回既有记录，绝不会启动第二次调用。
 */
export async function startGeneration(
  input: StartGenerationInput
): Promise<StartGenerationResult> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select ${branchTrees.id}
      from ${branchTrees}
      where ${branchTrees.id} = ${input.treeId}
        and ${branchTrees.userId} = ${input.userId}
      for update
    `)
    if (locked.length === 0) {
      throw new GenerationRepositoryError("not_found", "分支树不存在")
    }

    const [tree] = await tx
      .select({ state: branchTrees.state })
      .from(branchTrees)
      .where(
        and(
          eq(branchTrees.id, input.treeId),
          eq(branchTrees.userId, input.userId)
        )
      )
    if (!tree) {
      throw new GenerationRepositoryError("not_found", "分支树不存在")
    }

    const [replayed] = await tx
      .select()
      .from(branchGenerations)
      .where(
        and(
          eq(branchGenerations.id, input.generationId),
          eq(branchGenerations.userId, input.userId)
        )
      )
    if (replayed) {
      assertReplayMatches(replayed, input)
      return { created: false, generation: replayed }
    }

    const turnSnapshot = verifyTurn(tree.state, input)
    const [attemptRow] = await tx
      .select({ value: max(branchGenerations.attempt) })
      .from(branchGenerations)
      .where(
        and(
          eq(branchGenerations.treeId, input.treeId),
          eq(branchGenerations.threadId, input.threadId),
          eq(branchGenerations.assistantMessageId, input.assistantMessageId)
        )
      )
    const attempt = (attemptRow?.value ?? 0) + 1
    const now = new Date()

    await tx
      .update(branchGenerations)
      .set({
        isCurrent: false,
        status: "superseded",
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(branchGenerations.treeId, input.treeId),
          eq(branchGenerations.threadId, input.threadId),
          eq(branchGenerations.assistantMessageId, input.assistantMessageId),
          eq(branchGenerations.isCurrent, true)
        )
      )

    const [created] = await tx
      .insert(branchGenerations)
      .values({
        id: input.generationId,
        userId: input.userId,
        treeId: input.treeId,
        threadId: input.threadId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        attempt,
        isCurrent: true,
        status: "running",
        modelId: input.modelId,
        assistantMessageIndex: turnSnapshot.assistantMessageIndex,
        turnSnapshot,
        heartbeatAt: now,
        updatedAt: now,
      })
      .returning()

    return { created: true, generation: created }
  })
}

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

export async function compareAndSetGenerationTerminal(input: {
  generationId: string
  status: "completed" | "stopped" | "failed"
  result: GenerationResultV1
  error?: string | null
  billingStatus?: GenerationRow["billingStatus"]
}): Promise<GenerationRow | null> {
  const allowedFrom: GenerationStatus[] =
    input.status === "completed"
      ? ["running"]
      : input.status === "stopped"
        ? ["running", "stop_requested"]
        : ["running", "stop_requested"]
  const now = new Date()
  const [updated] = await db
    .update(branchGenerations)
    .set({
      status: input.status,
      result: input.result,
      error: input.error ?? null,
      billingStatus: input.billingStatus ?? "not_billable",
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(branchGenerations.id, input.generationId),
        inArray(branchGenerations.status, allowedFrom)
      )
    )
    .returning()
  if (updated) return updated

  const [current] = await db
    .select()
    .from(branchGenerations)
    .where(eq(branchGenerations.id, input.generationId))
  return current ?? null
}

function staleFailureResult(row: GenerationRow): GenerationResultV1 {
  const partial = row.turnSnapshot.assistantMessage
  return {
    version: 1,
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
  }
}

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

export async function treeHasActiveGenerations(
  userId: string,
  treeId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: branchGenerations.id })
    .from(branchGenerations)
    .where(
      and(
        eq(branchGenerations.userId, userId),
        eq(branchGenerations.treeId, treeId),
        inArray(branchGenerations.status, ACTIVE_GENERATION_STATUSES)
      )
    )
    .limit(1)
  return Boolean(row)
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

export function isExecutionTerminal(status: GenerationStatus): boolean {
  return !ACTIVE_GENERATION_STATUSES.includes(
    status as (typeof ACTIVE_GENERATION_STATUSES)[number]
  )
}
