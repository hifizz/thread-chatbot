import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  conversationGenerations,
  conversationMessageFeedback,
  conversationMessages,
  conversationThreads,
  conversations,
  projects,
  workspaceMembers,
} from "@/lib/db/schema"
import type { MessageFeedback } from "@/lib/thread-chat/contracts/message-feedback"
import type { CanonicalMessageFeedback } from "@/lib/thread-chat/contracts/conversation-message-feedback"

export async function listCanonicalMessageFeedback(input: {
  userId: string
  conversationId: string
}): Promise<CanonicalMessageFeedback[]> {
  const rows = await db
    .select({ feedback: conversationMessageFeedback })
    .from(conversationMessageFeedback)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMessageFeedback.conversationId)
    )
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, input.userId)
      )
    )
    .where(
      and(
        eq(conversationMessageFeedback.userId, input.userId),
        eq(conversationMessageFeedback.conversationId, input.conversationId)
      )
    )
  return rows.map(({ feedback }) => ({
    conversationId: feedback.conversationId,
    threadId: feedback.threadId,
    messageId: feedback.messageId,
    feedback: feedback.feedback,
    updatedAt: feedback.updatedAt.toISOString(),
  }))
}

export async function setCanonicalMessageFeedback(input: {
  userId: string
  conversationId: string
  threadId: string
  messageId: string
  feedback: MessageFeedback | null
}): Promise<
  | { ok: true; feedback: CanonicalMessageFeedback | null }
  | { ok: false; reason: "not_found" | "not_completed" | "missing_generation" }
> {
  return db.transaction(async (tx) => {
    const [message] = await tx
      .select({
        role: conversationMessages.role,
        contentState: conversationMessages.contentState,
      })
      .from(conversationMessages)
      .innerJoin(
        conversationThreads,
        and(
          eq(conversationThreads.id, conversationMessages.threadId),
          eq(conversationThreads.conversationId, input.conversationId)
        )
      )
      .innerJoin(
        conversations,
        eq(conversations.id, conversationThreads.conversationId)
      )
      .innerJoin(projects, eq(projects.id, conversations.projectId))
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projects.workspaceId),
          eq(workspaceMembers.userId, input.userId)
        )
      )
      .where(
        and(
          eq(conversationMessages.id, input.messageId),
          eq(conversationMessages.threadId, input.threadId)
        )
      )
      .limit(1)
    if (!message) return { ok: false, reason: "not_found" as const }
    if (message.role !== "assistant" || message.contentState !== "complete")
      return { ok: false, reason: "not_completed" as const }
    const [generation] = await tx
      .select({ id: conversationGenerations.id })
      .from(conversationGenerations)
      .where(
        and(
          eq(conversationGenerations.ownerId, input.userId),
          eq(conversationGenerations.conversationId, input.conversationId),
          eq(conversationGenerations.threadId, input.threadId),
          eq(conversationGenerations.outputMessageId, input.messageId),
          eq(conversationGenerations.status, "completed")
        )
      )
      .limit(1)
    if (!generation) return { ok: false, reason: "missing_generation" as const }
    const identity = and(
      eq(conversationMessageFeedback.userId, input.userId),
      eq(conversationMessageFeedback.conversationId, input.conversationId),
      eq(conversationMessageFeedback.messageId, input.messageId)
    )
    if (input.feedback === null) {
      await tx.delete(conversationMessageFeedback).where(identity)
      return { ok: true, feedback: null }
    }
    const now = new Date()
    const [saved] = await tx
      .insert(conversationMessageFeedback)
      .values({ ...input, feedback: input.feedback, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          conversationMessageFeedback.userId,
          conversationMessageFeedback.conversationId,
          conversationMessageFeedback.messageId,
        ],
        set: {
          feedback: input.feedback,
          threadId: input.threadId,
          updatedAt: now,
        },
      })
      .returning()
    return {
      ok: true,
      feedback: {
        conversationId: saved!.conversationId,
        threadId: saved!.threadId,
        messageId: saved!.messageId,
        feedback: saved!.feedback,
        updatedAt: saved!.updatedAt.toISOString(),
      },
    }
  })
}
