import type { ToolSet } from "ai"
import { readUrlTool, webSearchTool } from "@/lib/chat/research-tools"
import type { ResearchRoute } from "@/lib/chat/research-router"
import { surfaceTools } from "@/app/api/chat/surface-tools"

type ChatToolSetInput = {
  researchMode: ResearchRoute["mode"]
  searchReady: boolean
  threadChat: boolean
  markdownArtifactRequested: boolean
  /** assistant-ui 使用其内嵌 AI SDK 类型；只在最终组合出口统一适配。 */
  frontendToolSet?: Record<string, unknown>
}

/** 将各能力的私有工具集合组合成一次模型调用唯一可见的 ToolSet。 */
export function buildChatToolSet({
  researchMode,
  searchReady,
  threadChat,
  markdownArtifactRequested,
  frontendToolSet,
}: ChatToolSetInput): { tools: ToolSet; webToolsEnabled: boolean } {
  const webToolsEnabled = searchReady && researchMode !== "answer"
  const routedWebTools: ToolSet =
    researchMode === "fetch"
      ? { readUrl: readUrlTool }
      : researchMode === "search" || researchMode === "research"
        ? { webSearch: webSearchTool, readUrl: readUrlTool }
        : {}

  return {
    webToolsEnabled,
    tools: {
      ...surfaceTools({ threadChat, markdownArtifactRequested }),
      ...(webToolsEnabled ? routedWebTools : {}),
      ...(frontendToolSet ?? {}),
    } as ToolSet,
  }
}
