import type { ToolSet } from "ai"
import { createResearchTools } from "@/lib/chat/research-tools"
import type { ResearchRoute } from "@/lib/chat/research-router"
import { surfaceTools } from "@/app/api/chat/surface-tools"
import { researchToolNames } from "@/app/api/chat/research-tool-capabilities"

type ChatToolSetInput = {
  researchMode: ResearchRoute["mode"]
  routeReason?: ResearchRoute["reasonCode"]
  searchReady: boolean
  /** assistant-ui 使用其内嵌 AI SDK 类型；只在最终组合出口统一适配。 */
  frontendToolSet?: Record<string, unknown>
}

/** 将各能力的私有工具集合组合成一次模型调用唯一可见的 ToolSet。 */
export function buildChatToolSet({
  researchMode,
  routeReason,
  searchReady,
  frontendToolSet,
}: ChatToolSetInput): { tools: ToolSet; webToolsEnabled: boolean } {
  const webToolsEnabled = searchReady && researchMode !== "answer"
  const researchTools = createResearchTools({ routeReason })
  const routedWebTools = Object.fromEntries(
    researchToolNames(researchMode).map((name) => [name, researchTools[name]])
  ) as ToolSet

  return {
    webToolsEnabled,
    tools: {
      ...surfaceTools(),
      ...(webToolsEnabled ? routedWebTools : {}),
      ...(frontendToolSet ?? {}),
    } as ToolSet,
  }
}
