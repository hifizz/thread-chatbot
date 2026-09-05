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
  "createMarkdownArtifact" | "webSearch" | "readUrl"

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
}): ThreadChatGenerationMode {
  const { researchMode, artifactRequested } = input
  const tools: GenerationToolName[] = []
  if (artifactRequested) tools.push("createMarkdownArtifact")
  if (researchMode === "fetch") tools.push("readUrl")
  if (researchMode === "search" || researchMode === "research")
    tools.push("webSearch", "readUrl")

  const firstTool =
    researchMode === "fetch"
      ? "readUrl"
      : researchMode === "search" || researchMode === "research"
        ? "webSearch"
        : artifactRequested
          ? "createMarkdownArtifact"
          : null

  return Object.freeze({
    id: MODE_IDS[researchMode][artifactRequested ? 1 : 0],
    researchMode,
    artifactRequested,
    systemParts: Object.freeze([
      buildThreadChatSystem({ enableMarkdownArtifact: artifactRequested }),
      ...(researchMode === "fetch" ? [DIRECT_FETCH_SYSTEM_PROMPT] : []),
      ...(researchMode === "search" || researchMode === "research"
        ? [WEB_ACCESS_SYSTEM_PROMPT]
        : []),
      ...(researchMode === "research" ? [RESEARCH_SYSTEM_PROMPT] : []),
    ]),
    toolNames: Object.freeze(tools),
    firstTool,
    maxSteps: researchMode === "answer" ? 5 : RESEARCH_MAX_STEPS,
  })
}
