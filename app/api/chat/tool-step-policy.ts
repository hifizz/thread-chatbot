import { MARKDOWN_ARTIFACT_TOOL_NAME } from "@/lib/chat/markdown-artifact"
import type { ResearchRoute } from "@/lib/chat/research-router"
import {
  researchToolNames,
  type ResearchToolName,
} from "@/app/api/chat/research-tool-capabilities"

type ToolStepPolicyInput = {
  isThreadChat: boolean
  markdownArtifactRequested: boolean
  researchMode: ResearchRoute["mode"]
}

type RoutedToolName = ResearchToolName | typeof MARKDOWN_ARTIFACT_TOOL_NAME

type ToolStep = {
  activeTools: RoutedToolName[]
  toolChoice?: {
    type: "tool"
    toolName: RoutedToolName
  }
}

/**
 * 生成工具的逐步暴露策略：首步强制当前路由的联网工具；明确的 Markdown
 * 交付仅在没有更高优先级联网动作时首步强制，后续步骤保留全部可用工具。
 */
export function createToolStepPolicy({
  isThreadChat,
  markdownArtifactRequested,
  researchMode,
}: ToolStepPolicyInput) {
  const activeWebTools = [...researchToolNames(researchMode)]
  const activeTools: RoutedToolName[] = isThreadChat
    ? [
        ...(markdownArtifactRequested ? [MARKDOWN_ARTIFACT_TOOL_NAME] : []),
        ...activeWebTools,
      ]
    : activeWebTools

  if (activeTools.length === 0) return undefined

  return ({ stepNumber }: { stepNumber: number }): ToolStep => {
    if (stepNumber === 0 && activeWebTools.length > 0) {
      return {
        activeTools,
        toolChoice: { type: "tool", toolName: activeWebTools[0] },
      }
    }
    if (stepNumber === 0 && markdownArtifactRequested) {
      return {
        activeTools,
        toolChoice: {
          type: "tool",
          toolName: MARKDOWN_ARTIFACT_TOOL_NAME,
        },
      }
    }
    return { activeTools }
  }
}
