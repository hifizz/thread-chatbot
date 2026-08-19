import { and, desc, eq, inArray, lt, max, sql } from "drizzle-orm"
import type { ThreadTreeState } from "@/lib/thread-chat/domain/types"
import { parseThreadTreeState } from "@/lib/thread-chat/domain/message-graph"
import {
  prepareRegenerationPatch,
  type PreparedTurnPatch,
} from "@/lib/thread-chat/domain/regeneration"
import type {
  GenerationResultV1,
  GenerationStatus,
  GenerationSummary,
  GenerationTurnIdentity,
  GenerationTurnSnapshot,
  ThreadChatGenerationIntent,
} from "@/lib/thread-chat/domain/generation"
import {
  ACTIVE_GENERATION_STATUSES,
  GENERATION_ERRORS,
  GENERATION_LEASE_MS,
} from "@/constants/generation"
import { db } from "@/lib/db"
import { branchGenerations, branchTrees } from "@/lib/db/schema"

export class GenerationRepositoryError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "generation_conflict"
      | "invalid_turn"
      | "not_latest_turn"
      | "persistence_failed",
    message: string
  ) {
    super(message)
    this.name = "GenerationRepositoryError"
  }
}

export type StartGenerationInput = GenerationTurnIdentity & {
  userId: string
  modelId: string
  intent: ThreadChatGenerationIntent
}

type GenerationRow = typeof branchGenerations.$inferSelect

export type StartGenerationResult = {
  created: boolean
  generation: GenerationRow
}

export type PrepareGenerationResult =
  | {
      created: true
      generation: GenerationRow
      state: ThreadTreeState
      revision: number
      turnSnapshot: GenerationTurnSnapshot
      patch?: PreparedTurnPatch
    }
  | { created: false; generation: GenerationRow }

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

  let state: ThreadTreeState
  try {
    state = parseThreadTreeState(stateValue)
  } catch {
    throw new GenerationRepositoryError(
      "invalid_turn",
      "已保存的分支树消息图无效"
    )
  }

  const thread = state.threads[input.threadId]
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
    assistantMessageIndex < 0 ||
    userMessageIndex < 0 ||
    userMessage?.role !== "user" ||
    assistantMessage?.role !== "assistant" ||
    assistantMessage.parentMessageId !== userMessage.id ||
    thread.activeLeafMessageId !== assistantMessage.id ||
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
    userParentMessageId: userMessage.parentMessageId,
    assistantParentMessageId: userMessage.id,
    activatesAssistantMessageId: assistantMessage.id,
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
      "generation_conflict",
      "generation id 已被其他生成请求使用"
    )
  }
}

/**
 * 严格 start transaction。只有它返回 created=true 时调用方才可以发起付费模型请求；
 * 同 generation id 重放返回既有记录，绝不会启动第二次调用。
 */
export async function prepareGeneration(
  input: StartGenerationInput
): Promise<PrepareGenerationResult> {
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
      .select({ state: branchTrees.state, revision: branchTrees.revision })
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

    const intent = input.intent
    let state: ThreadTreeState
    try {
      state = parseThreadTreeState(tree.state)
    } catch {
      throw new GenerationRepositoryError(
        "invalid_turn",
        "已保存的分支树消息图无效"
      )
    }
    let patch: PreparedTurnPatch | undefined
    let revision = tree.revision
    if (intent.kind !== "persisted-turn") {
      const targetIds = [input.assistantMessageId]
      if (intent.kind === "edit-last-user") targetIds.push(input.userMessageId)
      if (
        Object.values(state.threads).some((thread) =>
          thread.messages.some((message) => targetIds.includes(message.id))
        )
      )
        throw new GenerationRepositoryError(
          "generation_conflict",
          "新消息 id 已被其他生成占用"
        )
      const sourceMessageId =
        intent.kind === "regenerate-assistant"
          ? intent.sourceAssistantMessageId
          : intent.kind === "edit-last-user"
            ? intent.sourceUserMessageId
            : input.userMessageId
      const sourceExists = state.threads[input.threadId]?.messages.some(
        (message) => message.id === sourceMessageId
      )
      if (!sourceExists)
        throw new GenerationRepositoryError(
          "invalid_turn",
          "生成来源消息不存在"
        )
      patch =
        prepareRegenerationPatch(state, {
          threadId: input.threadId,
          userMessageId: input.userMessageId,
          assistantMessageId: input.assistantMessageId,
          generationId: input.generationId,
          intent,
        }) ?? undefined
      if (!patch)
        throw new GenerationRepositoryError(
          "not_latest_turn",
          "只能编辑或重新生成当前 active path 的最后一轮"
        )
      const thread = state.threads[input.threadId]
      thread.messages.push(
        ...patch.addedMessages.map((message) => structuredClone(message))
      )
      thread.activeLeafMessageId = patch.nextActiveLeafMessageId
      const [updatedTree] = await tx
        .update(branchTrees)
        .set({
          state,
          revision: sql`${branchTrees.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(branchTrees.id, input.treeId),
            eq(branchTrees.userId, input.userId),
            eq(branchTrees.revision, tree.revision)
          )
        )
        .returning({ revision: branchTrees.revision })
      if (!updatedTree)
        throw new GenerationRepositoryError(
          "generation_conflict",
          "分支树修订号已变更，请刷新后重试"
        )
      revision = updatedTree.revision

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
            eq(branchGenerations.isCurrent, true),
            inArray(branchGenerations.status, ACTIVE_GENERATION_STATUSES)
          )
        )
    }

    const turnSnapshot = verifyTurn(state, input)
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

    if (intent.kind === "persisted-turn")
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

    return {
      created: true,
      generation: created,
      state,
      revision,
      turnSnapshot,
      ...(patch ? { patch } : {}),
    }
  })
}

export async function startGeneration(
  input: StartGenerationInput
): Promise<StartGenerationResult> {
  return prepareGeneration(input)
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
