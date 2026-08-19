import type { Message } from "../core/types"

export interface AssistantMessagePresentation {
  hasVisibleText: boolean
  hasVisibleContent: boolean
  isWaitingForVisibleOutput: boolean
  showBubble: boolean
  showCaret: boolean
}

export function assistantMessagePresentation(
  message: Message
): AssistantMessagePresentation {
  const hasVisibleText = message.text.trim().length > 0
  const hasVisibleContent =
    hasVisibleText || Boolean(message.webResearch?.length)
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
