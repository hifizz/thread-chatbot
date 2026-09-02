import type { ConversationViewMessage } from "../../core/types"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

export type ThreadChatUIPart = ThreadChatUIMessage["parts"][number]
export type AssistantPartRenderKind =
  | "text"
  | "reasoning"
  | "research"
  | "file"
  | "source-url"
  | "tool"

export interface AssistantPartRenderPlanItem {
  kind: AssistantPartRenderKind
  part: ThreadChatUIPart
  index: number
}

function fallbackParts(message: ConversationViewMessage): ThreadChatUIPart[] {
  return message.text
    ? ([{ type: "text", text: message.text, state: "done" }] as ThreadChatUIPart[])
    : []
}

export function assistantPartRenderPlan(
  message: ConversationViewMessage
): AssistantPartRenderPlanItem[] {
  const parts = message.uiParts ?? fallbackParts(message)
  const plan: AssistantPartRenderPlanItem[] = []
  let researchPanelRendered = false

  parts.forEach((part, index) => {
    if (part.type === "text") {
      plan.push({ kind: "text", part, index })
      return
    }
    if (part.type === "reasoning" && part.text.trim()) {
      plan.push({ kind: "reasoning", part, index })
      return
    }
    if (part.type === "data-research-activity") {
      if (!researchPanelRendered) {
        researchPanelRendered = true
        plan.push({ kind: "research", part, index })
      }
      return
    }
    if (part.type === "file" || part.type === "reasoning-file") {
      plan.push({ kind: "file", part, index })
      return
    }
    if (part.type === "source-url") {
      plan.push({ kind: "source-url", part, index })
      return
    }
    if (part.type.startsWith("tool-")) {
      plan.push({ kind: "tool", part, index })
    }
  })

  return plan
}
