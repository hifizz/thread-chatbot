import type { Message, MessageFeedback } from "../core/types"
import type { RecoverableTurn } from "../generation/types"
import type { ThreadMessageActionCommands } from "./message-action-commands"
import type { SourceProvenance } from "../core/message-graph"

export const MESSAGE_ACTION_LABELS = {
  toolbar: "消息操作",
  copy: "复制",
  copied: "已复制",
  edit: "重新编辑",
  regenerate: "重新生成",
  positive: "点赞",
  negative: "点踩",
} as const

export const MESSAGE_ACTION_ERRORS = {
  clipboard: "复制失败，请检查浏览器剪贴板权限",
  latestUserOnly: "仅支持编辑当前最后一轮",
  latestAssistantOnly: "仅支持重新生成当前最后一轮",
  noMarkdown: "该回复没有可复制的 Markdown 正文",
  feedbackSave: "反馈保存失败，请重试",
} as const

/** 未完成回复不暴露复制或评价；失败恢复由独立 Retry 入口负责。 */
export function hasCompletedAssistantActions(message: Message): boolean {
  return message.role === "assistant" && message.status === "done"
}

export interface ThreadMessageActionPresentation {
  latestUserMessageId?: string
  latestAssistantMessageId?: string
  alternatives: readonly {
    assistantMessageId: string
    derivedThreadCount: number
  }[]
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
  message: Message
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

export interface TurnVariantPickerProps {
  threadId: string
  activeAssistantMessageId: string
  alternatives: readonly {
    assistantMessageId: string
    derivedThreadCount: number
  }[]
  onSwitch: ThreadMessageActionCommands["switchTurnVariant"]
}
