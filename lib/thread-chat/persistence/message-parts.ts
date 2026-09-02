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
