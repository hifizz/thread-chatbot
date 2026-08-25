import { invariant } from "./domain-error"
import type { MessageId } from "./ids"
import type { Message } from "./message"

export type BaseContextV1 = {
  schemaVersion: 1
  messageIds: MessageId[]
}

export function validateBaseContext(value: unknown): BaseContextV1 {
  invariant(
    typeof value === "object" && value !== null,
    "base_context_invalid",
    "BaseContext 必须是对象。"
  )
  const candidate = value as { schemaVersion?: unknown; messageIds?: unknown }
  invariant(
    candidate.schemaVersion === 1 && Array.isArray(candidate.messageIds),
    "base_context_invalid",
    "BaseContext 必须使用 schemaVersion=1 与 messageIds。"
  )
  invariant(
    candidate.messageIds.every(
      (messageId): messageId is string =>
        typeof messageId === "string" && messageId.length > 0
    ),
    "base_context_invalid",
    "BaseContext.messageIds 必须是非空字符串数组。"
  )
  invariant(
    new Set(candidate.messageIds).size === candidate.messageIds.length,
    "base_context_invalid",
    "BaseContext.messageIds 不得重复。"
  )
  return { schemaVersion: 1, messageIds: [...candidate.messageIds] }
}

export function resolveBaseContextMessages(
  context: BaseContextV1,
  messagesById: ReadonlyMap<MessageId, Message>
): Message[] {
  return context.messageIds.map((messageId) => {
    const message = messagesById.get(messageId)
    invariant(
      message,
      "base_context_message_missing",
      `BaseContext 引用的 Message ${messageId} 不存在。`
    )
    return message
  })
}
