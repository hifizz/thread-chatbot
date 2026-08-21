import type {
  ConversationMessage,
  ConversationSnapshot,
  ConversationTurn,
  MessageId,
  MessageRole,
  TurnId,
} from "./conversation-model.ts"

export type VariantSelectionFailureCode =
  | "turn_not_found"
  | "message_not_found"
  | "version_conflict"
  | "cross_thread"
  | "cross_turn"
  | "role_mismatch"
  | "message_unavailable"

export type VariantSelectionResult =
  | { readonly ok: true; readonly turn: ConversationTurn }
  | {
      readonly ok: false
      readonly code: VariantSelectionFailureCode
      readonly currentRevision?: number
    }

export interface SelectActiveVariantInput {
  readonly turnId: TurnId
  readonly messageId: MessageId
  readonly role: Extract<MessageRole, "user" | "assistant">
  readonly expectedRevision: number
}

function canBecomeActive(message: ConversationMessage): boolean {
  return (
    message.contentState === "complete" || message.contentState === "incomplete"
  )
}

export function selectActiveVariant(
  snapshot: ConversationSnapshot,
  input: SelectActiveVariantInput
): VariantSelectionResult {
  const turn = snapshot.turns[input.turnId]
  if (!turn) return { ok: false, code: "turn_not_found" }
  const message = snapshot.messages[input.messageId]
  if (!message) return { ok: false, code: "message_not_found" }
  if (turn.revision !== input.expectedRevision)
    return {
      ok: false,
      code: "version_conflict",
      currentRevision: turn.revision,
    }
  if (message.threadId !== turn.threadId)
    return { ok: false, code: "cross_thread" }
  if (message.turnId !== turn.id) return { ok: false, code: "cross_turn" }
  if (message.role !== input.role) return { ok: false, code: "role_mismatch" }
  if (!canBecomeActive(message))
    return { ok: false, code: "message_unavailable" }

  return {
    ok: true,
    turn:
      input.role === "user"
        ? {
            ...turn,
            activeUserMessageId: message.id,
            revision: turn.revision + 1,
          }
        : {
            ...turn,
            activeAssistantMessageId: message.id,
            revision: turn.revision + 1,
          },
  }
}
