import type { MessageKey } from "@/lib/i18n/dictionary"
import type { Message, ConversationViewMessage, MessageFeedback } from "../../core/types"
import type { ThreadMessageActionCommands } from "./message-action-commands"
import type { SourceProvenance } from "../../core/message-graph"

export const MESSAGE_ACTION_LABEL_KEYS = {
  toolbar: "ui.messageActions",
  copy: "chat.copy",
  copied: "chat.copied",
  edit: "ui.editAgain",
  regenerate: "chat.regenerate",
  positive: "ui.helpful",
  negative: "ui.notHelpful",
} as const satisfies Record<string, MessageKey>

export const MESSAGE_ACTION_ERROR_KEYS = {
  clipboard: "ui.couldNotCopyCheckYourBrowser",
  latestUserOnly: "ui.onlyTheLatestTurnCanBe",
  latestAssistantOnly: "ui.onlyTheLatestTurnCanBe2",
  noMarkdown: "ui.thisReplyHasNoMarkdownContent",
  feedbackSave: "ui.couldNotSaveYourFeedbackPlease",
} as const satisfies Record<string, MessageKey>

/** Legacy recovery UI shape retained only as a read-only presentation slot. */
export interface RecoverableTurn {
  threadId: string
  userMessageId: string
  assistantMessageId?: string
  reason: "missing_assistant" | "missing_generation" | "interrupted_generation"
}

/** 未完成回复不暴露复制或评价；失败恢复由独立 Retry 入口负责。 */
export function hasCompletedAssistantActions(message: Message): boolean {
  return message.role === "assistant" && message.status === "done"
}

export interface ThreadMessageActionPresentation {
  latestUserMessageId?: string
  latestAssistantMessageId?: string
  sourceProvenance: SourceProvenance | null
}

/** 列模式和画布模式共享的只读消息操作视图状态。 */
export interface MessageActionViewState {
  recoverableByUserMessageId: ReadonlyMap<string, RecoverableTurn>
  feedbackByMessageId: ReadonlyMap<string, MessageFeedback>
  activePathByThreadId: ReadonlyMap<string, readonly string[]>
  presentationByThreadId: ReadonlyMap<string, ThreadMessageActionPresentation>
}

export interface EditableUserMessageProps {
  threadId: string
  message: ConversationViewMessage
  editable: boolean
  recovery?: RecoverableTurn
  commands: Pick<
    ThreadMessageActionCommands,
    "retryUserTurn" | "editAndRegenerate"
  >
}

export interface AssistantMessageToolbarProps {
  threadId: string
  message: Message
  regeneratable: boolean
  feedback?: MessageFeedback
  commands: Pick<
    ThreadMessageActionCommands,
    "retryAssistant" | "submitFeedback"
  >
}
