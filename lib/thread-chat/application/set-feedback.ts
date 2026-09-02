import { eq } from "drizzle-orm"
import { messages } from "@/lib/db/schema"
import type { SetFeedbackCommand } from "@/lib/thread-chat/contracts/commands"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import { enqueueFeedbackScore } from "@/lib/thread-chat/persistence/feedback-score-outbox-repository"
import { toMessageDTO } from "@/lib/thread-chat/persistence/mappers"
import { lockOwnedMessage } from "@/lib/thread-chat/persistence/message-repository"
import { withConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

export function setMessageFeedback(
  userId: string,
  messageId: string,
  command: SetFeedbackCommand
) {
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "feedback",
      scopeId: messageId,
      payload: command,
      execute: async () => {
        const message = await lockOwnedMessage(tx, userId, messageId)
        if (!message) notFound()
        if (message.role !== "assistant") {
          stateConflict("只能评价助手消息")
        }
        const updatedAt = new Date()
        const [updated] = await tx
          .update(messages)
          .set({ feedback: command.feedback, updatedAt })
          .where(eq(messages.id, message.id))
          .returning()
        await enqueueFeedbackScore(tx, {
          messageId: message.id,
          feedback: command.feedback,
          sourceUpdatedAt: updatedAt,
        })
        return toMessageDTO(updated)
      },
    })
  )
}
