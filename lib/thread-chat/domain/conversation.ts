import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

export const CONVERSATION_MESSAGE_STATUSES = [
  "generating",
  "completed",
  "stopped",
  "failed",
] as const

export type ConversationMessageStatus =
  (typeof CONVERSATION_MESSAGE_STATUSES)[number]

export type ConversationMessageRole = "user" | "assistant"

/** 纯领域层需要的规范化消息形状；不包含 DB 或 React 细节。 */
export interface ConversationMessage {
  id: string
  threadId: string
  sequence: number
  role: ConversationMessageRole
  parts: ThreadChatUIMessage["parts"]
  status: ConversationMessageStatus
  replacesMessageId: string | null
  supersededAt: string | null
}

/** 纯领域层需要的 Thread 拓扑形状。 */
export interface ConversationThread {
  id: string
  projectId: string
  parentId: string | null
  forkMessageId: string | null
  forkContext: readonly string[]
  depth: number
}
