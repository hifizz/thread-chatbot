import { invariant } from "./domain-error"
import type { MessageId } from "./ids"
import type { Message } from "./message"
import type { MessageRun } from "./message-run"

export function buildPromptHistory(input: {
  baseMessageIds: readonly MessageId[]
  baseMessages: readonly Message[]
  currentMessages: readonly Message[]
  assistantRuns: readonly MessageRun[]
}): Message[] {
  const baseById = new Map(
    input.baseMessages.map((message) => [message.id, message])
  )
  const orderedBase = input.baseMessageIds.map((messageId) => {
    const message = baseById.get(messageId)
    invariant(
      message,
      "base_context_message_missing",
      `BaseContext 引用的 Message ${messageId} 不存在。`
    )
    return message
  })
  const completedAssistantIds = new Set(
    input.assistantRuns
      .filter((run) => run.status === "completed")
      .map((run) => run.assistantMessageId)
  )
  const seen = new Set<MessageId>()
  return [...orderedBase, ...input.currentMessages].filter((message) => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    if (message.finalizedAt === null) return false
    return message.role === "user" || completedAssistantIds.has(message.id)
  })
}
