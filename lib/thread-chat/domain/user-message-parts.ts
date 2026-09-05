import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

export interface UserMessageFileReference {
  url: string
  mediaType: string
  filename?: string
}

/** 服务端持久化和前端即时展示使用同一份用户消息内容。引用是可选内容。 */
export function buildUserParts(
  text: string,
  files: readonly UserMessageFileReference[],
  quoteText?: string | null
): ThreadChatUIMessage["parts"] {
  return [
    ...(quoteText
      ? [{ type: "data-quote" as const, data: { text: quoteText } }]
      : []),
    { type: "text", text },
    ...files.map((file) => ({
      type: "file" as const,
      url: file.url,
      mediaType: file.mediaType,
      ...(file.filename ? { filename: file.filename } : {}),
    })),
  ]
}

/** 编辑正文时保留消息已有的引用，不从 Thread 自动重建已移除的引用。 */
export function userMessageQuoteText(
  parts: ThreadChatUIMessage["parts"]
): string | undefined {
  return parts.find((part) => part.type === "data-quote")?.data.text
}
