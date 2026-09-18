import { sql } from "drizzle-orm"
import { feedbackScoreOutbox } from "@/lib/db/schema"
import type { MessageFeedback } from "@/lib/thread-chat/contracts/dto"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

export function enqueueFeedbackScore(
  tx: ConversationTransaction,
  input: {
    messageId: string
    feedback: MessageFeedback | null
    sourceUpdatedAt: Date
    traceId?: string | null
    traceMappingVersion?: number | null
  }
) {
  const value = input.feedback ?? "cleared"
  return tx
    .insert(feedbackScoreOutbox)
    .values({
      messageId: input.messageId,
      value,
      sourceUpdatedAt: input.sourceUpdatedAt,
      nextAttemptAt: input.sourceUpdatedAt,
      traceId: input.traceId ?? null,
      traceMappingVersion: input.traceMappingVersion ?? null,
    })
    .onConflictDoUpdate({
      target: feedbackScoreOutbox.messageId,
      set: {
        value,
        sourceUpdatedAt: input.sourceUpdatedAt,
        traceId: input.traceId ?? null,
        traceMappingVersion: input.traceMappingVersion ?? null,
        version: sql`${feedbackScoreOutbox.version} + 1`,
        attempts: 0,
        nextAttemptAt: input.sourceUpdatedAt,
        lastErrorCategory: null,
        updatedAt: input.sourceUpdatedAt,
      },
    })
}
