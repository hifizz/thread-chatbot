import type { ConversationMessage } from "@/lib/thread-chat/domain/conversation"
import { canSupersedeAssistant } from "@/lib/thread-chat/domain/state-machine"

export interface ConversationTurn {
  userMessage: ConversationMessage
  assistantMessage: ConversationMessage | null
}

export function currentTimeline<T extends ConversationMessage>(
  messages: readonly T[]
): T[] {
  return messages
    .filter((message) => message.supersededAt === null)
    .toSorted((left, right) => left.sequence - right.sequence)
}

export function latestTurn(
  messages: readonly ConversationMessage[]
): ConversationTurn | null {
  const timeline = currentTimeline(messages)
  const userIndex = timeline.findLastIndex((message) => message.role === "user")
  if (userIndex === -1) return null

  const userMessage = timeline[userIndex]
  const assistantMessage =
    timeline.slice(userIndex + 1).find((message) => message.role === "assistant") ??
    null

  return { userMessage, assistantMessage }
}

export function canEditLatestUserTurn(
  messages: readonly ConversationMessage[],
  userMessageId: string
): boolean {
  return latestTurn(messages)?.userMessage.id === userMessageId
}

export function canRetryLatestAssistant(
  messages: readonly ConversationMessage[],
  assistantMessageId: string
): boolean {
  const assistant = latestTurn(messages)?.assistantMessage
  return (
    assistant?.id === assistantMessageId && canSupersedeAssistant(assistant)
  )
}

export function findMessageIncludingSuperseded<T extends ConversationMessage>(
  messages: readonly T[],
  messageId: string
): T | null {
  return messages.find((message) => message.id === messageId) ?? null
}
