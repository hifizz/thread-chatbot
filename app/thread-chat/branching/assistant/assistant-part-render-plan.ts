import type { ConversationViewMessage } from "../../core/types"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

export type ThreadChatUIPart = ThreadChatUIMessage["parts"][number]
export type AssistantTracePart = Extract<ThreadChatUIPart,
  { type: "reasoning" | "data-research-plan" | "data-research-activity" | `tool-${string}` | "dynamic-tool" }
>
export interface AssistantTraceItem {
  part: AssistantTracePart
  index: number
}
export type AssistantPartRenderPlanItem =
  | { kind: "trace"; items: AssistantTraceItem[]; index: number }
  | { kind: "text" | "file" | "source-url" | "tool"; part: ThreadChatUIPart; index: number }

/** 保留正文边界；工具原生 part 与派生活动只渲染一次，位置以工具开始为准。 */
export function assistantPartRenderPlan(message: ConversationViewMessage): AssistantPartRenderPlanItem[] {
  const parts = message.uiParts ?? (message.text
    ? [{ type: "text" as const, text: message.text, state: "done" as const }]
    : [])
  const nativeCalls = new Set(parts.flatMap((part) => "toolCallId" in part ? [part.toolCallId] : []))
  const plan: AssistantPartRenderPlanItem[] = []
  let trace: Extract<AssistantPartRenderPlanItem, { kind: "trace" }> | undefined

  parts.forEach((part, index) => {
    if (part.type === "data-research-activity" && nativeCalls.has(part.data.toolCallId)) return
    if (
      part.type === "reasoning" || part.type === "data-research-plan" ||
      part.type === "data-research-activity" || part.type === "dynamic-tool" ||
      (part.type.startsWith("tool-") && part.type !== "tool-createMarkdownArtifact")
    ) {
      if (!trace) {
        trace = { kind: "trace", items: [], index }
        plan.push(trace)
      }
      trace.items.push({ part: part as AssistantTracePart, index })
      return
    }
    const kind = part.type === "text" && part.text.trim() ? "text"
      : part.type === "file" || part.type === "reasoning-file" ? "file"
      : part.type === "source-url" ? "source-url"
      : part.type === "tool-createMarkdownArtifact" ? "tool" : null
    if (kind) {
      trace = undefined
      plan.push({ kind, part, index })
    }
  })
  return plan
}
