import type { ConversationViewMessage } from "../../core/types"

export interface AssistantMessagePresentation {
  hasVisibleText: boolean
  hasVisibleContent: boolean
  isWaitingForVisibleOutput: boolean
  /** streaming 中但正文尚未开始：轨迹已展开时在正文起始处并行显示 typing */
  showInlineTyping: boolean
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

  const isStreaming = message.status === "streaming"

  return {
    hasVisibleText,
    hasVisibleContent,
    isWaitingForVisibleOutput,
    showInlineTyping: isStreaming && !hasVisibleText,
    showBubble: hasVisibleContent || isWaitingForVisibleOutput,
    showCaret: isStreaming && hasVisibleText,
  }
}
