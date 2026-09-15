import { DOCUMENT_INSTRUCTIONS, DOCUMENT_LIMITS, DOCUMENT_TOOL_NAMES } from "@/constants/project-documents"
import { researchToolNames } from "@/lib/chat/research-tool-capabilities"
import {
  DIRECT_FETCH_SYSTEM_PROMPT,
  RESEARCH_MAX_STEPS,
  RESEARCH_SYSTEM_PROMPT,
  WEB_ACCESS_SYSTEM_PROMPT,
} from "@/constants/research"
import type { ResearchRouteMode } from "@/lib/chat/research-contract"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"
import type { ThreadChatGenerationModeId } from "@/lib/thread-chat/contracts/prompt-cache"

export type GenerationToolName =
  "createMarkdownArtifact" | "webSearch" | "readUrl" | typeof DOCUMENT_TOOL_NAMES[number]

export interface ThreadChatGenerationMode {
  id: ThreadChatGenerationModeId
  researchMode: ResearchRouteMode
  artifactRequested: boolean
  systemParts: readonly string[]
  toolNames: readonly GenerationToolName[]
  firstTool: GenerationToolName | null
  maxSteps: number
}

const MODE_IDS: Record<
  ResearchRouteMode,
  readonly [ThreadChatGenerationModeId, ThreadChatGenerationModeId]
> = {
  answer: ["answer", "answer-artifact"],
  fetch: ["fetch", "fetch-artifact"],
  search: ["search", "search-artifact"],
  research: ["research", "research-artifact"],
}

export function resolveGenerationMode(input: {
  researchMode: ResearchRouteMode
  artifactRequested: boolean
  documentTools?: readonly typeof DOCUMENT_TOOL_NAMES[number][]
}): ThreadChatGenerationMode {
  const { researchMode, artifactRequested, documentTools = [] } = input
  const tools: GenerationToolName[] = []
  if (artifactRequested) tools.push("createMarkdownArtifact")
  tools.push(...researchToolNames(researchMode), ...documentTools)

  const firstTool =
    researchMode === "fetch"
      ? "readUrl"
      : researchMode === "search" || researchMode === "research"
        ? "webSearch"
        : artifactRequested && documentTools.length === 0
          ? "createMarkdownArtifact"
          : null

  return Object.freeze({
    id: MODE_IDS[researchMode][artifactRequested ? 1 : 0],
    researchMode,
    artifactRequested,
    systemParts: Object.freeze([
      buildThreadChatSystem({ enableMarkdownArtifact: artifactRequested }),
      ...(documentTools.length ? [DOCUMENT_INSTRUCTIONS] : []),
      ...(researchMode === "fetch" ? [DIRECT_FETCH_SYSTEM_PROMPT] : []),
      ...(researchMode === "search" || researchMode === "research"
        ? [WEB_ACCESS_SYSTEM_PROMPT]
        : []),
      ...(researchMode === "research" ? [RESEARCH_SYSTEM_PROMPT] : []),
    ]),
    toolNames: Object.freeze(tools),
    firstTool,
    maxSteps: Math.max(researchMode === "answer" ? 5 : RESEARCH_MAX_STEPS,
      documentTools.length ? DOCUMENT_LIMITS.toolSteps : 0),
  })
}
