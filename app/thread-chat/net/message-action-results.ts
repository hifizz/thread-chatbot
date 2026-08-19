export type MessageActionFailureCode =
  | "not_found"
  | "invalid_id"
  | "invalid_request"
  | "invalid_thread_model"
  | "invalid_turn"
  | "not_latest_turn"
  | "generation_conflict"
  | "model_mismatch"
  | "tree_revision_conflict"
  | "revision_required"
  | "persistence_failed"
  | "unauthorized"
  | "network_error"

export type GenerationActionResult =
  | {
      ok: true
      generationId: string
      userMessageId: string
      assistantMessageId: string
      sourceUserMessageId?: string
      sourceAssistantMessageId?: string
    }
  | { ok: false; code: MessageActionFailureCode; message: string }

export type VariantSwitchResult =
  | {
      ok: true
      threadId: string
      assistantMessageId: string
      revision: number
    }
  | { ok: false; code: MessageActionFailureCode; message: string }
