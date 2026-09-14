import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

/** transient data parts 仅用于活跃流展示，任何 DB checkpoint/finalize 前都必须剥离。 */
export function persistentMessageParts(
  parts: ThreadChatUIMessage["parts"]
): ThreadChatUIMessage["parts"] {
  return parts.filter(
    (part) =>
      !("transient" in part && (part as { transient?: boolean }).transient)
  )
}

/** 工具提交收据独立于流 checkpoint；恢复时按 toolCallId 替换不完整卡片。 */
export function restoreDocumentToolParts(parts: ThreadChatUIMessage["parts"], committed: ThreadChatUIMessage["parts"] = []): ThreadChatUIMessage["parts"] {
  const remaining = new Map(committed.flatMap((part) => "toolCallId" in part ? [[part.toolCallId, part] as const] : []))
  const restored = parts.map((part) => {
    if (!("toolCallId" in part)) return part
    const result = remaining.get(part.toolCallId)
    remaining.delete(part.toolCallId)
    return result ?? part
  })
  return [...restored, ...remaining.values()]
}
