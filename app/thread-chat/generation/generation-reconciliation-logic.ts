import type { ThreadTreeState } from "../core/types"
import type { GenerationSummary } from "./types"

export function isGenerationInFlight(
  status: GenerationSummary["status"]
): boolean {
  return status === "running" || status === "stop_requested"
}

export function initialGenerationIds(
  generations: readonly GenerationSummary[]
): Set<string> {
  return new Set(
    generations
      .filter((generation) => isGenerationInFlight(generation.status))
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
