export type { MessageActionFailureCode } from "@/lib/thread-chat/contracts/message-action-failure"

import type { MessageActionFailureCode } from "@/lib/thread-chat/contracts/message-action-failure"

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
