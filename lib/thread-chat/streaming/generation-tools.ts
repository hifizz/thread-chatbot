import { tool, type ToolSet } from "ai"
import {
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  markdownArtifactInputSchema,
} from "@/lib/chat/markdown-artifact"
import { createResearchTools } from "@/lib/chat/research-tools"
import { artifactIdForTool } from "@/lib/thread-chat/streaming/artifacts"
import { canonicalHash } from "@/lib/thread-chat/application/prompt-cache"
import { THREAD_TOOL_PROFILE_VERSION } from "@/constants/thread-chat"

export type GenerationToolProfileId =
  | "thread-answer-v1"
  | "thread-artifact-v1"
  | "thread-web-v1"
  | "thread-web-artifact-v1"

const PROFILE_TOOL_NAMES: Record<GenerationToolProfileId, readonly string[]> = {
  "thread-answer-v1": [],
  "thread-artifact-v1": ["createMarkdownArtifact"],
  "thread-web-v1": ["webSearch", "readUrl"],
  "thread-web-artifact-v1": [
    "createMarkdownArtifact",
    "webSearch",
    "readUrl",
  ],
}

const TOOL_PROFILE_DESCRIPTOR = {
  version: THREAD_TOOL_PROFILE_VERSION,
  tools: {
    createMarkdownArtifact: {
      description: MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
      schema: "markdownArtifactInputSchema-v1",
    },
    webSearch: {
      description:
        "联网搜索以获取实时或事实性信息。用于回答需要最新资料、外部知识的问题。可多次调用以覆盖不同子问题。",
      schema: "webSearchInput-v1",
    },
    readUrl: {
      description:
        "深读某个网页的完整正文。URL 可以由用户直接提供，也可以来自搜索结果；翻译、总结或分析指定页面时应直接调用。",
      schema: "readUrlInput-v1",
    },
  },
} as const

export type GenerationToolProfile = {
  id: GenerationToolProfileId
  hash: string
  toolNames: readonly string[]
}

export type BuiltGenerationTools = {
  profile: GenerationToolProfile
  tools: ToolSet
}

export function selectGenerationToolProfile(input: {
  artifactRequested: boolean
  researchMode: "answer" | "fetch" | "search" | "research"
  searchReady: boolean
}): GenerationToolProfileId {
  const web = input.searchReady && input.researchMode !== "answer"
  if (web && input.artifactRequested) return "thread-web-artifact-v1"
  if (web) return "thread-web-v1"
  if (input.artifactRequested) return "thread-artifact-v1"
  return "thread-answer-v1"
}

export function generationToolProfile(
  id: GenerationToolProfileId
): GenerationToolProfile {
  const toolNames = PROFILE_TOOL_NAMES[id]
  return {
    id,
    toolNames,
    hash: canonicalHash({
      id,
      version: THREAD_TOOL_PROFILE_VERSION,
      tools: toolNames.map(
        (name) =>
          TOOL_PROFILE_DESCRIPTOR.tools[
            name as keyof typeof TOOL_PROFILE_DESCRIPTOR.tools
          ]
      ),
    }),
  }
}

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
}): BuiltGenerationTools {
  const profile = generationToolProfile(selectGenerationToolProfile(input))
  const { readUrl: readUrlTool, webSearch: webSearchTool } =
    createResearchTools({ routeReason: input.routeReason })
  const available = {
    createMarkdownArtifact: createMarkdownArtifactTool(input.messageId),
    webSearch: webSearchTool,
    readUrl: readUrlTool,
  } as const
  const tools = Object.fromEntries(
    profile.toolNames.map((name) => [
      name,
      available[name as keyof typeof available],
    ])
  ) as ToolSet
  return { profile, tools }
}
