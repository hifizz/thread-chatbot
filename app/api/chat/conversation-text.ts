import type { UIMessage } from "ai"
import { RESEARCH_ROUTER_CONTEXT_MESSAGES } from "@/constants/research"

/** 只看最后一条 user 消息的文本 part，供高置信首步强制路由。 */
export function latestUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== "user") continue
    return message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
  }
  return ""
}

/** Router 只取最近少量纯文本上下文，用于理解“这个/它”等指代。 */
export function recentConversationText(messages: UIMessage[]): string {
  return messages
    .slice(-RESEARCH_ROUTER_CONTEXT_MESSAGES)
    .map((message) => {
      const text = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
      return `${message.role}: ${text}`
    })
    .join("\n")
}
