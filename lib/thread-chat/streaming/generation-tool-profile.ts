import type { ToolSet } from "ai"
import { promptContentHash } from "@/lib/thread-chat/prompt-cache/hash"

export type GenerationToolProfileId =
  | "thread-answer-v1"
  | "thread-artifact-v1"
  | "thread-fetch-v1"
  | "thread-web-v1"
  | "thread-web-artifact-v1"

export interface GenerationToolProfile {
  id: GenerationToolProfileId
  orderedToolNames: readonly string[]
  hash: string
}

const PROFILE_TOOL_NAMES: Record<
  GenerationToolProfileId,
  readonly string[]
> = {
  "thread-answer-v1": [],
  "thread-artifact-v1": ["createMarkdownArtifact"],
  "thread-fetch-v1": ["readUrl"],
  "thread-web-v1": ["webSearch", "readUrl"],
  "thread-web-artifact-v1": [
    "createMarkdownArtifact",
    "webSearch",
    "readUrl",
  ],
}

export function resolveGenerationToolProfile(input: {
  artifactRequested: boolean
  researchMode: "answer" | "fetch" | "search" | "research"
  searchReady: boolean
}): GenerationToolProfile {
  let id: GenerationToolProfileId
  if (!input.searchReady || input.researchMode === "answer") {
    id = input.artifactRequested
      ? "thread-artifact-v1"
      : "thread-answer-v1"
  } else if (input.researchMode === "fetch" && !input.artifactRequested) {
    id = "thread-fetch-v1"
  } else if (input.artifactRequested) {
    id = "thread-web-artifact-v1"
  } else {
    id = "thread-web-v1"
  }
  const orderedToolNames = PROFILE_TOOL_NAMES[id]
  return {
    id,
    orderedToolNames,
    hash: promptContentHash({ id, orderedToolNames }),
  }
}

export function assertToolSetMatchesProfile(
  tools: ToolSet,
  profile: GenerationToolProfile
): void {
  const actual = Object.keys(tools)
  if (
    actual.length !== profile.orderedToolNames.length ||
    actual.some((name, index) => name !== profile.orderedToolNames[index])
  ) {
    throw new Error(
      `Tool profile ${profile.id} expected ${profile.orderedToolNames.join(",")} but received ${actual.join(",")}`
    )
  }
}
