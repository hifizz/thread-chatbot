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
  toolNames: readonly ("createMarkdownArtifact" | "webSearch" | "readUrl")[]
  routeReason?: string
}) {
  const { readUrl: readUrlTool, webSearch: webSearchTool } =
    createResearchTools({ routeReason: input.routeReason })
  return Object.fromEntries(
    input.toolNames.map((name) => [
      name,
      name === "createMarkdownArtifact"
        ? createMarkdownArtifactTool(input.messageId)
        : name === "webSearch"
          ? webSearchTool
          : readUrlTool,
    ])
  )
}
