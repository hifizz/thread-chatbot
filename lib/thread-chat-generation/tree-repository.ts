import { and, eq, sql } from "drizzle-orm"
import {
  activeLeafTurn,
  assistantTurnAlternatives,
  parseThreadTreeState,
} from "@/lib/thread-chat/domain/message-graph"
import type { ThreadTreeState } from "@/lib/thread-chat/domain/types"
import { db } from "@/lib/db"
import { branchTrees } from "@/lib/db/schema"

export type TreeCommandErrorCode =
  "not_found" | "tree_revision_conflict" | "invalid_turn"

export class TreeCommandError extends Error {
  constructor(
    readonly code: TreeCommandErrorCode,
    message: string,
    readonly currentRevision?: number
  ) {
    super(message)
    this.name = "TreeCommandError"
  }
}

export async function switchActiveLeafForOwner(input: {
  userId: string
  treeId: string
  threadId: string
  assistantMessageId: string
  baseRevision: number
}): Promise<{
  revision: number
  thread: { id: string; activeLeafMessageId: string }
}> {
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
