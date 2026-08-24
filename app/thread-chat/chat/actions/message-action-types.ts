export const MESSAGE_ACTION_LABELS = {
  toolbar: "消息操作",
  copy: "复制",
  copied: "已复制",
  edit: "重新编辑",
  fork: "从此消息分叉",
  forkSelection: "从选中内容分叉",
  regenerate: "重新生成",
  positive: "点赞",
  negative: "点踩",
} as const

export const MESSAGE_ACTION_ERRORS = {
  clipboard: "复制失败，请检查浏览器剪贴板权限",
  latestUserOnly: "仅支持编辑当前最后一轮",
  latestAssistantOnly: "仅支持重新生成当前最后一轮",
  incompleteFeedback: "只有完整回复可以评价",
  noMarkdown: "该回复没有可复制的 Markdown 正文",
  feedbackSave: "反馈保存失败，请重试",
} as const

export type MessageActionFeedback = "positive" | "negative" | null

export function messageActionError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
