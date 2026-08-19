import { MARKDOWN_ARTIFACT_TOOL_NAME } from "@/lib/chat/markdown-artifact"
import type { ResearchRoute } from "@/lib/chat/research-router"

type ToolStepPolicyInput = {
  isThreadChat: boolean
  markdownArtifactRequested: boolean
  researchMode: ResearchRoute["mode"]
}

type RoutedToolName =
  "readUrl" | "webSearch" | typeof MARKDOWN_ARTIFACT_TOOL_NAME

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
  const activeWebTools: RoutedToolName[] =
    researchMode === "fetch"
      ? ["readUrl"]
      : researchMode === "search" || researchMode === "research"
        ? ["webSearch", "readUrl"]
        : []
  const activeTools: RoutedToolName[] = isThreadChat
    ? [
        ...(markdownArtifactRequested ? [MARKDOWN_ARTIFACT_TOOL_NAME] : []),
        ...activeWebTools,
      ]
    : activeWebTools

  if (activeTools.length === 0) return undefined

  return ({ stepNumber }: { stepNumber: number }): ToolStep => {
    if (stepNumber === 0 && researchMode === "fetch") {
      return {
        activeTools,
        toolChoice: { type: "tool", toolName: "readUrl" },
      }
    }
    if (
      stepNumber === 0 &&
      (researchMode === "search" || researchMode === "research")
    ) {
      return {
        activeTools,
        toolChoice: { type: "tool", toolName: "webSearch" },
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
