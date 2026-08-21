import type { ConversationId, ThreadId } from "../domain/conversation-model.ts"

/**
 * 纯展示状态。这里的任何字段都不得参与 Conversation revision 或领域写入。
 */
export interface ConversationUiWorkspace {
  readonly conversationId: ConversationId
  readonly visibleThreadIds: readonly ThreadId[]
  readonly foldedThreadIds: readonly ThreadId[]
  readonly selectedThreadId: ThreadId | null
  readonly canvasViewport: Readonly<{
    x: number
    y: number
    zoom: number
  }>
  readonly openPanels: readonly string[]
  readonly draftsByThreadId: Readonly<Record<string, string>>
}
