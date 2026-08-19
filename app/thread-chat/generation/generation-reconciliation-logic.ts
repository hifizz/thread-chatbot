import type { MergeGenerationResultInput } from "./merge-result"
import type { ThreadTreeState } from "../core/types"
import {
  isActiveGenerationStatus,
  type GenerationSummary,
  type RecoverableTurn,
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

/** 将 owner-scoped generation 终态投影成 store 的窄 CAS 命令。 */
export function terminalGenerationResultInput(
  generation: GenerationSummary
): MergeGenerationResultInput | null {
  if (!generation.result) return null
  return {
    threadId: generation.threadId,
    assistantMessageId: generation.assistantMessageId,
    generationId: generation.id,
    result: generation.result,
  }
}

/** generation 记录消失时，只定位仍由它拥有的本地 pending turn。 */
export function missingGenerationTurn(
  state: ThreadTreeState,
  generationId: string
): (RecoverableTurn & { assistantMessageId: string }) | null {
  for (const thread of Object.values(state.threads)) {
    const assistant = thread.messages.find(
      (message) =>
        message.role === "assistant" &&
        message.generationId === generationId &&
        (message.status === "pending" || message.status === "streaming")
    )
    if (!assistant) continue
    const user = thread.messages.find(
      (message) =>
        message.role === "user" && message.id === assistant.parentMessageId
    )
    if (!user) return null
    return {
      threadId: thread.id,
      userMessageId: user.id,
      assistantMessageId: assistant.id,
      reason: "missing_generation",
    }
  }
  return null
}
