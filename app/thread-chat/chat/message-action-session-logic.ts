import type { MessageFeedback, MessageFeedbackSummary } from "../core/types"
import type { RecoverableTurn } from "../generation/types"

export function indexRecoverableTurns(turns: readonly RecoverableTurn[]) {
  return new Map(turns.map((turn) => [turn.userMessageId, turn]))
}

export function indexMessageFeedbacks(
  entries: readonly MessageFeedbackSummary[]
) {
  return new Map(entries.map((entry) => [entry.messageId, entry.feedback]))
}

export function withoutRecoverableTurn(
  current: ReadonlyMap<string, RecoverableTurn>,
  userMessageId: string
) {
  const next = new Map(current)
  next.delete(userMessageId)
  return next
}

export function withRecoverableTurn(
  current: ReadonlyMap<string, RecoverableTurn>,
  turn: RecoverableTurn
) {
  const next = new Map(current)
  next.set(turn.userMessageId, turn)
  return next
}

export function withMessageFeedback(
  current: ReadonlyMap<string, MessageFeedback>,
  messageId: string,
  feedback: MessageFeedback | null
) {
  const next = new Map(current)
  if (feedback) next.set(messageId, feedback)
  else next.delete(messageId)
  return next
}
