import type { ConversationViewMessage } from "../../core/types"

export interface AssistantMessagePresentation {
  hasVisibleText: boolean
  hasVisibleContent: boolean
  isWaitingForVisibleOutput: boolean
  showBubble: boolean
  showCaret: boolean
}

export function assistantMessagePresentation(
  message: ConversationViewMessage
): AssistantMessagePresentation {
  const hasVisibleText = message.text.trim().length > 0
  const hasVisibleReasoning =
    message.uiParts?.some(
      (part) => part.type === "reasoning" && part.text.trim().length > 0
    ) ?? false
  const hasVisibleContent =
    hasVisibleText || hasVisibleReasoning || Boolean(message.webResearch?.length)
  const isWaitingForVisibleOutput =
    message.role === "assistant" &&
    (message.status === "pending" || message.status === "streaming") &&
    !hasVisibleContent &&
    !message.artifactIds?.length &&
    !message.markdownGeneration

  return {
    hasVisibleText,
    hasVisibleContent,
    isWaitingForVisibleOutput,
    showBubble: hasVisibleContent || isWaitingForVisibleOutput,
    showCaret: message.status === "streaming" && hasVisibleText,
  }
}
