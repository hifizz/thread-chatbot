import {
  WEB_RESEARCH_TOOL_NAMES,
  type WebResearchActivity,
} from "@/lib/chat/web-research-activity"
import type { ConversationViewMessage } from "../../core/types"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { DOCUMENT_TOOL_NAMES } from "@/constants/project-documents"

export type ThreadChatUIPart = ThreadChatUIMessage["parts"][number]
export type AssistantPartRenderKind =
  | "text"
  | "reasoning"
  | "research"
  | "visualization"
  | "file"
  | "source-url"
  | "artifact"
  | "document"
  | "tool"

const DOCUMENT_TOOL_PART_TYPES: ReadonlySet<string> = new Set(
  DOCUMENT_TOOL_NAMES.map((name) => `tool-${name}`)
)

export interface AssistantPartRenderPlanItem {
  kind: AssistantPartRenderKind
  part: ThreadChatUIPart
  index: number
  /** 连续的联网活动合并为一个轨迹块展示；仅 research 项携带。 */
  activities?: WebResearchActivity[]
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
      const last = plan.at(-1)
      if (last?.kind === "research") {
        last.activities?.push(part.data)
        return
      }
      plan.push({ kind: "research", part, index, activities: [part.data] })
      return
    }
    if (part.type === "data-visualization") {
      plan.push({ kind: "visualization", part, index })
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
    // 联网和可视化工具都有专用产品 UI，不输出内部 input/output 状态。
    if (WEB_RESEARCH_TOOL_NAMES.some((name) => part.type === `tool-${name}`)) return
    // Markdown 交付物原位渲染：生成中→流式预览块，完成→artifact 卡片。
    if (part.type === "tool-createMarkdownArtifact") {
      plan.push({ kind: "artifact", part, index })
      return
    }
    // 文档工具走专属渲染；不得落入 createMarkdownArtifact 的"生成文档"轨迹文案。
    if (DOCUMENT_TOOL_PART_TYPES.has(part.type)) {
      plan.push({ kind: "document", part, index })
      return
    }
    if (part.type === "tool-generate_visualization") return
    if (part.type.startsWith("tool-")) {
      plan.push({ kind: "tool", part, index })
    }
  })

  return plan
}
