/** 工作区内部：从分支来源导航到 Markdown Artifact 的固定 DOM 事件名。 */
export const ARTIFACT_SOURCE_NAVIGATION_EVENT =
  "thread-chat:artifact-source-navigation" as const

/** 等待 ProjectPanel/MarkdownBody 完成渲染的有界重试参数。 */
export const ARTIFACT_SOURCE_LOCATE_ATTEMPTS = 8
export const ARTIFACT_SOURCE_LOCATE_DELAY_MS = 60
export const ARTIFACT_SOURCE_HIGHLIGHT_MS = 1800
