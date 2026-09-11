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
  const hasVisibleContent =
    hasVisibleText || Boolean(message.webResearch?.length) ||
    Boolean(message.uiParts?.some((part) =>
      part.type === "data-research-plan" || part.type === "reasoning" ||
      part.type === "data-research-activity" || part.type === "tool-webSearch" ||
      part.type === "tool-readUrl" || part.type === "dynamic-tool"
    ))
  const isWaitingForVisibleOutput =
    message.role === "assistant" &&
    (message.status === "pending" || message.status === "streaming") &&
    !hasVisibleContent &&
    !message.artifactIds?.length &&
    !message.markdownGeneration

  const latestOutput = message.uiParts?.findLast((part) =>
    part.type === "text" || part.type === "reasoning" || part.type.startsWith("tool-") || part.type === "dynamic-tool"
  )

  return {
    hasVisibleText,
    hasVisibleContent,
    isWaitingForVisibleOutput,
    showBubble: hasVisibleContent || isWaitingForVisibleOutput,
    showCaret: message.status === "streaming" && hasVisibleText &&
      (!message.uiParts || (latestOutput?.type === "text" && latestOutput.state === "streaming")),
  }
}
