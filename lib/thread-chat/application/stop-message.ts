import { and, eq, isNull } from "drizzle-orm"
import { messages } from "@/lib/db/schema"
import type { StopMessageCommand } from "@/lib/thread-chat/contracts/commands"
import { notFound } from "@/lib/thread-chat/application/errors"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import { toMessageDTO } from "@/lib/thread-chat/persistence/mappers"
import { lockOwnedMessage } from "@/lib/thread-chat/persistence/message-repository"
import { withConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

export function requestMessageStop(
  userId: string,
  messageId: string,
  command: StopMessageCommand
) {
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "stop",
      scopeId: messageId,
      payload: command,
      execute: async () => {
        const message = await lockOwnedMessage(tx, userId, messageId)
        if (!message) notFound()
        if (message.status !== "generating") return toMessageDTO(message)
        const now = new Date()
        const [updated] = await tx
          .update(messages)
          .set({ stopRequestedAt: now, updatedAt: now })
          .where(
            and(
              eq(messages.id, message.id),
              eq(messages.status, "generating"),
              isNull(messages.stopRequestedAt)
            )
          )
          .returning()
        return toMessageDTO(updated ?? { ...message, stopRequestedAt: now })
      },
    })
  )
}
