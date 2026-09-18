import {
  WEB_RESEARCH_TOOL_NAMES,
  type WebResearchActivity,
} from "@/lib/chat/web-research-activity"
import type { ConversationViewMessage } from "../../core/types"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

export type ThreadChatUIPart = ThreadChatUIMessage["parts"][number]
export type DocumentToolPart = Extract<
  ThreadChatUIPart,
  {
    type:
      | "tool-findProjectDocuments"
      | "tool-readProjectDocument"
      | "tool-updateProjectDocument"
  }
>
export type AssistantPartRenderKind =
  | "text"
  | "reasoning"
  | "research"
  | "file"
  | "source-url"
  | "artifact"
  | "document"
  | "tool"

export interface AssistantPartRenderPlanItem {
  kind: AssistantPartRenderKind
  part: ThreadChatUIPart
  index: number
  /** 连续的联网活动合并为一个轨迹块展示；仅 research 项携带。 */
  activities?: WebResearchActivity[]
  /** 连续的文档工具调用合并为一个时序轨迹块；仅 document 项携带。 */
  documents?: DocumentToolPart[]
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
    if (part.type === "file" || part.type === "reasoning-file") {
      plan.push({ kind: "file", part, index })
      return
    }
    if (part.type === "source-url") {
      plan.push({ kind: "source-url", part, index })
      return
    }
    // 联网工具由研究面板展示，不输出内部 input-available 等状态。
    if (WEB_RESEARCH_TOOL_NAMES.some((name) => part.type === `tool-${name}`)) return
    // Markdown 交付物原位渲染：生成中→流式预览块，完成→artifact 卡片。
    if (part.type === "tool-createMarkdownArtifact") {
      plan.push({ kind: "artifact", part, index })
      return
    }
    // 文档工具走专属渲染；不得落入 createMarkdownArtifact 的"生成文档"轨迹文案。
    // 连续调用合并为一个时序轨迹块（查找→读取→提交）。
    if (
      part.type === "tool-findProjectDocuments" ||
      part.type === "tool-readProjectDocument" ||
      part.type === "tool-updateProjectDocument"
    ) {
      const last = plan.at(-1)
      if (last?.kind === "document") {
        last.documents?.push(part)
        return
      }
      plan.push({ kind: "document", part, index, documents: [part] })
      return
    }
    if (part.type.startsWith("tool-")) {
      plan.push({ kind: "tool", part, index })
    }
  })

  return plan
}
