import { and, eq, inArray, sql } from "drizzle-orm"
import { ACTIVE_GENERATION_STATUSES } from "@/constants/generation"
import {
  activeLeafTurn,
  assistantTurnAlternatives,
  parseThreadTreeState,
} from "@/lib/thread-chat/domain/message-graph"
import type { ThreadTreeState } from "@/lib/thread-chat/domain/types"
import type {
  SwitchActiveLeafFailureReason,
  SwitchActiveLeafRequest,
  SwitchActiveLeafSuccessResponse,
} from "@/lib/thread-chat/contracts/switch-active-leaf"
import { db } from "@/lib/db"
import { branchGenerations, branchTrees } from "@/lib/db/schema"

export class TreeCommandError extends Error {
  constructor(
    readonly code: SwitchActiveLeafFailureReason,
    message: string,
    readonly currentRevision?: number
  ) {
    super(message)
    this.name = "TreeCommandError"
  }
}

export type DeleteOwnedTreeResult =
  | "deleted"
  | "not_found"
  | "generation_running"

/**
 * 删除与 generation start 共用 branch_trees 行锁：两者并发时，只可能先删除并让
 * start 得到 not_found，或先创建 generation 并让删除得到 generation_running。
 */
export async function deleteOwnedTreeIfIdle(input: {
  userId: string
  treeId: string
}): Promise<DeleteOwnedTreeResult> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select ${branchTrees.id}
      from ${branchTrees}
      where ${branchTrees.id} = ${input.treeId}
        and ${branchTrees.userId} = ${input.userId}
      for update
    `)
    if (locked.length === 0) return "not_found"

    const [activeGeneration] = await tx
      .select({ id: branchGenerations.id })
      .from(branchGenerations)
      .where(
        and(
          eq(branchGenerations.userId, input.userId),
          eq(branchGenerations.treeId, input.treeId),
          inArray(branchGenerations.status, ACTIVE_GENERATION_STATUSES)
        )
      )
      .limit(1)
    if (activeGeneration) return "generation_running"

    const [deleted] = await tx
      .delete(branchTrees)
      .where(
        and(
          eq(branchTrees.id, input.treeId),
          eq(branchTrees.userId, input.userId)
        )
      )
      .returning({ id: branchTrees.id })
    return deleted ? "deleted" : "not_found"
  })
}

export async function switchActiveLeafForOwner(
  input: SwitchActiveLeafRequest & {
    userId: string
    treeId: string
  }
): Promise<SwitchActiveLeafSuccessResponse> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select ${branchTrees.id}
      from ${branchTrees}
      where ${branchTrees.id} = ${input.treeId}
        and ${branchTrees.userId} = ${input.userId}
      for update
    `)
    if (locked.length === 0)
      throw new TreeCommandError("not_found", "分支树不存在")

    const [row] = await tx
      .select({ state: branchTrees.state, revision: branchTrees.revision })
      .from(branchTrees)
      .where(
        and(
          eq(branchTrees.id, input.treeId),
          eq(branchTrees.userId, input.userId)
        )
      )
    if (!row) throw new TreeCommandError("not_found", "分支树不存在")
    if (row.revision !== input.baseRevision)
      throw new TreeCommandError(
        "tree_revision_conflict",
        "该对话已在其他页面更新",
        row.revision
      )

    let state: ThreadTreeState
    try {
      state = parseThreadTreeState(row.state)
    } catch {
      throw new TreeCommandError("invalid_turn", "分支树消息结构无效")
    }
    const thread = state.threads[input.threadId]
    const currentTurn = thread ? activeLeafTurn(thread) : null
    if (!thread || !currentTurn?.assistantMessage)
      throw new TreeCommandError("invalid_turn", "当前会话没有可切换的最新回复")

    const alternatives = assistantTurnAlternatives(
      thread,
      currentTurn.assistantMessage.id
    )
    const target = alternatives.find(
      (message) => message.id === input.assistantMessageId
    )
    const targetHasMessageChildren = thread.messages.some(
      (message) => message.parentMessageId === target?.id
    )
    if (!target || targetHasMessageChildren)
      throw new TreeCommandError(
        "invalid_turn",
        "目标不是最新一轮的可切换回复版本"
      )

    thread.activeLeafMessageId = target.id
    const [updated] = await tx
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
          eq(branchTrees.revision, input.baseRevision)
        )
      )
      .returning({ revision: branchTrees.revision })
    if (!updated)
      throw new TreeCommandError(
        "tree_revision_conflict",
        "该对话已在其他页面更新"
      )

    return {
      revision: updated.revision,
      thread: { id: thread.id, activeLeafMessageId: target.id },
    }
  })
}
