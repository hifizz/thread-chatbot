import type {
  ConversationMessage,
  ConversationMessageStatus,
} from "@/lib/thread-chat/domain/conversation"

export type TerminalMessageStatus = Exclude<
  ConversationMessageStatus,
  "generating"
>

export function isTerminalMessageStatus(
  status: ConversationMessageStatus
): status is TerminalMessageStatus {
  return status !== "generating"
}

/** 等价于数据库 finalize 的 WHERE status = 'generating' 条件。 */
export function resolveFinalStatus(
  current: ConversationMessageStatus,
  requested: TerminalMessageStatus
): ConversationMessageStatus {
  return current === "generating" ? requested : current
}

export function canFinalizeMessage(message: ConversationMessage): boolean {
  return message.role === "assistant" && message.status === "generating"
}

export function canSupersedeAssistant(message: ConversationMessage): boolean {
  return (
    message.role === "assistant" &&
    isTerminalMessageStatus(message.status) &&
    message.supersededAt === null
  )
}

/** soft-supersede 只追加关系元数据，不改写旧消息内容或终态。 */
export function softSupersedeMessage<T extends ConversationMessage>(
  message: T,
  supersededAt: string
): T {
  if (message.supersededAt !== null) return message
  return { ...message, supersededAt }
}
