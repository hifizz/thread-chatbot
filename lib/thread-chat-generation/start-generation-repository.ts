import { and, eq, inArray, max, sql } from "drizzle-orm"
import type { ThreadTreeState } from "@/lib/thread-chat/domain/types"
import { parseThreadTreeState } from "@/lib/thread-chat/domain/message-graph"
import {
  prepareRegenerationPatch,
  type PreparedTurnPatch,
} from "@/lib/thread-chat/domain/regeneration"
import type {
  GenerationTurnIdentity,
  GenerationTurnSnapshot,
  ThreadChatGenerationIntent,
} from "@/lib/thread-chat/domain/generation"
import { ACTIVE_GENERATION_STATUSES } from "@/constants/generation"
import { db } from "@/lib/db"
import { branchGenerations, branchTrees } from "@/lib/db/schema"
import type { GenerationRow } from "@/lib/thread-chat-generation/query-repository"

export class GenerationRepositoryError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "generation_conflict"
      | "model_mismatch"
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
    row.userId !== input.userId ||
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
      .where(eq(branchGenerations.id, input.generationId))
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
    const targetThread = state.threads[input.threadId]
    if (!targetThread)
      throw new GenerationRepositoryError("invalid_turn", "目标会话不存在")
    if (targetThread.modelId !== input.modelId)
      throw new GenerationRepositoryError(
        "model_mismatch",
        "请求模型与目标会话不一致，请刷新后重试"
      )

    if (intent.kind === "persisted-turn") {
      const [otherActiveGeneration] = await tx
        .select({ id: branchGenerations.id })
        .from(branchGenerations)
        .where(
          and(
            eq(branchGenerations.treeId, input.treeId),
            eq(branchGenerations.threadId, input.threadId),
            eq(branchGenerations.isCurrent, true),
            inArray(branchGenerations.status, ACTIVE_GENERATION_STATUSES),
            sql`${branchGenerations.assistantMessageId} <> ${input.assistantMessageId}`
          )
        )
        .limit(1)
      if (otherActiveGeneration)
        throw new GenerationRepositoryError(
          "generation_conflict",
          "目标会话已有正在执行的生成，请等待完成或明确停止后重试"
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
