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

/** 展示和模型上下文共用的恢复入口；工具结果独立于流 checkpoint。
 * 已匹配的 toolCallId 原位替换；未匹配结果按持久化顺序追加，优先保留已保存事实。
 * 追加是缺失流位置时的兜底，不代表已恢复它相对于其他文本/工具的原始顺序。
 */
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
