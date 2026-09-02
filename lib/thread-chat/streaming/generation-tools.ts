import { tool } from "ai"
import {
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  markdownArtifactInputSchema,
} from "@/lib/chat/markdown-artifact"
import { createResearchTools } from "@/lib/chat/research-tools"
import { artifactIdForTool } from "@/lib/thread-chat/streaming/artifacts"

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
  artifactRequested: boolean
  researchMode: "answer" | "fetch" | "search" | "research"
  routeReason?: string
  searchReady: boolean
}) {
  const { readUrl: readUrlTool, webSearch: webSearchTool } =
    createResearchTools({ routeReason: input.routeReason })
  return {
    ...(input.artifactRequested
      ? { createMarkdownArtifact: createMarkdownArtifactTool(input.messageId) }
      : {}),
    ...(input.searchReady && input.researchMode === "fetch"
      ? { readUrl: readUrlTool }
      : {}),
    ...(input.searchReady &&
    (input.researchMode === "search" || input.researchMode === "research")
      ? { webSearch: webSearchTool, readUrl: readUrlTool }
      : {}),
  }
}
