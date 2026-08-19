import { and, eq } from "drizzle-orm"
import { parseThreadTreeState } from "@/app/thread-chat/core/message-graph"
import type {
  MessageFeedback,
  MessageFeedbackSummary,
  ThreadTreeState,
} from "@/app/thread-chat/core/types"
import { db } from "@/lib/db"
import {
  branchGenerations,
  branchMessageFeedback,
  branchTrees,
} from "@/lib/db/schema"

type SetMessageFeedbackResult =
  | { ok: true; feedback: MessageFeedbackSummary | null }
  | {
      ok: false
      reason: "not_found" | "not_completed" | "missing_generation"
    }

function toSummary(
  row: typeof branchMessageFeedback.$inferSelect
): MessageFeedbackSummary {
  return {
    treeId: row.treeId,
    threadId: row.threadId,
    messageId: row.messageId,
    feedback: row.feedback,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listMessageFeedbackForTree(
  userId: string,
  treeId: string
): Promise<MessageFeedbackSummary[]> {
  const rows = await db
    .select()
    .from(branchMessageFeedback)
    .where(
      and(
        eq(branchMessageFeedback.userId, userId),
        eq(branchMessageFeedback.treeId, treeId)
      )
    )
  return rows.map(toSummary)
}

/** Owner-scoped message feedback replacement; null deletes the current choice. */
export async function setMessageFeedbackForOwner(input: {
  userId: string
  treeId: string
  threadId: string
  messageId: string
  feedback: MessageFeedback | null
}): Promise<SetMessageFeedbackResult> {
  return db.transaction(async (tx) => {
    const [tree] = await tx
      .select({ state: branchTrees.state })
      .from(branchTrees)
      .where(
        and(
          eq(branchTrees.id, input.treeId),
          eq(branchTrees.userId, input.userId)
        )
      )
    if (!tree) return { ok: false, reason: "not_found" }

    let state: ThreadTreeState
    try {
      state = parseThreadTreeState(tree.state)
    } catch {
      return { ok: false, reason: "not_found" }
    }
    const message = state.threads[input.threadId]?.messages.find(
      (candidate) => candidate.id === input.messageId
    )
    if (!message) return { ok: false, reason: "not_found" }
    if (message.role !== "assistant" || message.status !== "done")
      return { ok: false, reason: "not_completed" }

    const [generation] = await tx
      .select({ id: branchGenerations.id })
      .from(branchGenerations)
      .where(
        and(
          eq(branchGenerations.userId, input.userId),
          eq(branchGenerations.treeId, input.treeId),
          eq(branchGenerations.threadId, input.threadId),
          eq(branchGenerations.assistantMessageId, input.messageId),
          eq(branchGenerations.status, "completed")
        )
      )
      .limit(1)
    if (!generation) return { ok: false, reason: "missing_generation" }

    const identity = and(
      eq(branchMessageFeedback.userId, input.userId),
      eq(branchMessageFeedback.treeId, input.treeId),
      eq(branchMessageFeedback.threadId, input.threadId),
      eq(branchMessageFeedback.messageId, input.messageId)
    )
    const [current] = await tx
      .select()
      .from(branchMessageFeedback)
      .where(identity)
    if (current?.feedback === input.feedback)
      return { ok: true, feedback: toSummary(current) }
    if (input.feedback === null) {
      await tx.delete(branchMessageFeedback).where(identity)
      return { ok: true, feedback: null }
    }

    const now = new Date()
    const [saved] = await tx
      .insert(branchMessageFeedback)
      .values({
        userId: input.userId,
        treeId: input.treeId,
        threadId: input.threadId,
        messageId: input.messageId,
        feedback: input.feedback,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          branchMessageFeedback.userId,
          branchMessageFeedback.treeId,
          branchMessageFeedback.threadId,
          branchMessageFeedback.messageId,
        ],
        set: { feedback: input.feedback, updatedAt: now },
      })
      .returning()
    return { ok: true, feedback: toSummary(saved) }
  })
}
