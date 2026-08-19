import type { ThreadTreeState } from "../core/types"
import {
  isActiveGenerationStatus,
  type GenerationSummary,
} from "./types"

export { isActiveGenerationStatus as isGenerationInFlight } from "./types"

export function initialGenerationIds(
  generations: readonly GenerationSummary[]
): Set<string> {
  return new Set(
    generations
      .filter((generation) => isActiveGenerationStatus(generation.status))
      .map((generation) => generation.id)
  )
}

export function messageGenerationIds(state: ThreadTreeState): string[] {
  return Object.values(state.threads).flatMap((thread) =>
    thread.messages.flatMap((message) =>
      message.role === "assistant" &&
      (message.status === "pending" || message.status === "streaming") &&
      message.generationId
        ? [message.generationId]
        : []
    )
  )
}
