import { activeMessagePath } from "../core/message-graph"
import { collectInherited } from "../core/selectors"
import type { Message, ThreadTreeState } from "../core/types"
import { INHERITED_CHAR_BUDGET } from "@/constants/thread-chat"
import { serializeMessageForModel } from "./message-serialization"
import { applyInheritedBudget, omittedNoticeText } from "./prompt-pure"

/** 发给 /api/chat 的最小消息形状（结构匹配 AI SDK UIMessage）。 */
export interface UIMessageLike {
  id: string
  role: "user" | "assistant"
  parts: { type: "text"; text: string }[]
}

function includable(message: Message, serialized: string | null): boolean {
  if (message.status === "error") return false
  return message.role === "user" || serialized !== null
}

/**
 * 从已提交的服务端树编译模型上下文：当前 Thread 跟 active path，
 * 祖先 Thread 跟 child.forkFromMsgId 的精确不可变来源路径。
 */
export function compileThreadChatMessages(input: {
  state: ThreadTreeState
  threadId: string
  excludeAssistantMessageId: string
}): UIMessageLike[] {
  const thread = input.state.threads[input.threadId]
  if (!thread) return []
  const messages: UIMessageLike[] = []
  const inherited: UIMessageLike[] = []

  for (const message of collectInherited(input.state, thread)) {
    const text = serializeMessageForModel(input.state, message)
    if (!includable(message, text) || text === null) continue
    inherited.push({
      id: `inh-${message.id}`,
      role: message.role,
      parts: [{ type: "text", text }],
    })
  }
  const { kept, omitted } = applyInheritedBudget(
    inherited,
    (message) => message.parts[0].text,
    INHERITED_CHAR_BUDGET
  )
  if (omitted > 0)
    messages.push({
      id: "inh-omitted",
      role: "user",
      parts: [{ type: "text", text: omittedNoticeText(omitted) }],
    })
  messages.push(...kept)

  for (const message of activeMessagePath(thread)) {
    if (message.id === input.excludeAssistantMessageId) continue
    const text = serializeMessageForModel(input.state, message)
    if (!includable(message, text) || text === null) continue
    messages.push({
      id: message.id,
      role: message.role,
      parts: [{ type: "text", text }],
    })
  }
  return messages
}
