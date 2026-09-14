import type { WebBudget } from "@/lib/ai/web-access"
import { tool, type ToolSet } from "ai"
import type { GenerationToolName } from "./generation-modes"
import {
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  markdownArtifactInputSchema,
} from "@/lib/chat/markdown-artifact"
import { createResearchTools } from "@/lib/chat/research-tools"
import { artifactIdForTool } from "@/lib/thread-chat/domain/tool-identity"
import { createGenerateVisualizationTool } from "@/lib/visualization/tool"

export function createMarkdownArtifactTool(messageId: string) {
  return tool({
    description: MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
    inputSchema: markdownArtifactInputSchema,
    execute: async (_input, { toolCallId }) => ({
      created: true as const,
      artifactId: artifactIdForTool(messageId, toolCallId),
    }),
  })
}

export function buildGenerationTools(input: {
  messageId: string
  toolNames: readonly GenerationToolName[]
  documentTools: ToolSet
  budget?: WebBudget
  routeReason?: string
}) {
  const { readUrl: readUrlTool, webSearch: webSearchTool } =
    createResearchTools({ routeReason: input.routeReason, budget: input.budget })
  const registry: ToolSet = {
    createMarkdownArtifact: createMarkdownArtifactTool(input.messageId),
    webSearch: webSearchTool,
    readUrl: readUrlTool,
    ...input.documentTools,
  }
  return {
    ...Object.fromEntries(input.toolNames.map((name) => [name, registry[name]])),
    // 可视化工具不参与按名选择，所有模式恒定附加。
    generate_visualization: createGenerateVisualizationTool(),
  }
}
