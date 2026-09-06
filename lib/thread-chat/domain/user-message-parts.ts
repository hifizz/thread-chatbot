import type { ThreadDTO } from "@/lib/thread-chat/contracts/dto"
import {
  messageContentToUiParts,
  type MessageContentInput,
  type MessageContentPartInput,
  type FileReference,
} from "@/lib/thread-chat/contracts/message-content"
import { THREAD_QUOTE_SCHEMA_VERSION } from "@/lib/thread-chat/contracts/quote"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

/** 仅首问补入分叉选区；显式传入的 Quote 与 parts 顺序保持不变。 */
export function buildForkUserParts(
  content: MessageContentInput,
  thread: Pick<ThreadDTO, "anchorText" | "forkAnchor" | "forkMessageId"> | undefined,
  sequence: number
): ThreadChatUIMessage["parts"] {
  const parts = messageContentToUiParts(content)
  if (
    sequence !== 1 ||
    !thread?.anchorText ||
    !thread.forkAnchor ||
    !thread.forkMessageId ||
    parts.some((part) => part.type === "data-quote")
  ) return parts
  return [{
    type: "data-quote",
    data: {
      schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
      text: thread.anchorText,
      source: {
        type: "message",
        messageId: thread.forkMessageId,
        anchor: thread.forkAnchor,
      },
    },
  }, ...parts]
}

/** 当前纯文本编辑器保留已有 V1 Quote 的内容和相对顺序。 */
export function editUserMessageContent(
  oldParts: ThreadChatUIMessage["parts"],
  text: string,
  files: readonly FileReference[]
): MessageContentInput {
  const parts: MessageContentPartInput[] = []
  let wroteText = false
  let fileIndex = 0
  for (const part of oldParts) {
    if (part.type === "data-quote" && "schemaVersion" in part.data) {
      parts.push({ type: "quote", quote: part.data })
    } else if (part.type === "text" && !wroteText) {
      parts.push({ type: "text", text })
      wroteText = true
    } else if (part.type === "file" && fileIndex < files.length) {
      parts.push({ type: "file", file: files[fileIndex++] })
    }
  }
  if (!wroteText) parts.push({ type: "text", text })
  for (const file of files.slice(fileIndex)) parts.push({ type: "file", file })
  return { parts }
}

/** 旧版引用不能作为新命令输入，只从已保存消息保留；不从 Thread 补造。 */
export function buildEditedUserParts(
  content: MessageContentInput,
  oldParts: ThreadChatUIMessage["parts"]
): ThreadChatUIMessage["parts"] {
  const parts = messageContentToUiParts(content)
  oldParts.forEach((part, index) => {
    if (part.type === "data-quote" && !("schemaVersion" in part.data)) {
      parts.splice(Math.min(index, parts.length), 0, part)
    }
  })
  return parts
}
