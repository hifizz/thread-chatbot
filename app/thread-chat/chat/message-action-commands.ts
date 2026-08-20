import type { MessageFeedback, MessageFeedbackSummary } from "../core/types"
import type { MessageActionFailureCode } from "@/lib/thread-chat/contracts/message-action-failure"

export type { MessageActionFailureCode }

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

/** 消息视图消费的动作能力；网络 controller 只是其中一种实现。 */
export interface ThreadMessageActionCommands {
  retryAssistant(
    threadId: string,
    assistantMessageId: string
  ): Promise<GenerationActionResult>
  retryUserTurn(
    threadId: string,
    userMessageId: string
  ): Promise<GenerationActionResult>
  editAndRegenerate(
    threadId: string,
    userMessageId: string,
    text: string
  ): Promise<GenerationActionResult>
  switchTurnVariant(
    threadId: string,
    assistantMessageId: string
  ): Promise<VariantSwitchResult>
  submitFeedback(
    threadId: string,
    messageId: string,
    feedback: MessageFeedback | null
  ): Promise<MessageFeedbackSummary | null>
}
