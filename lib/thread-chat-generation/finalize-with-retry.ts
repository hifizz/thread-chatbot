import {
  finalizeGeneration,
  type FinalizeGenerationInput,
} from "@/lib/thread-chat-generation/finalize"

type FinalizeGeneration = typeof finalizeGeneration

type FinalizeRetryDependencies = {
  finalize: FinalizeGeneration
  delay(ms: number): Promise<void>
}

const defaultDependencies: FinalizeRetryDependencies = {
  finalize: finalizeGeneration,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** generation 终态最多尝试三次；失败退避不改变输入或终态策略。 */
export async function finalizeGenerationWithRetry(
  input: FinalizeGenerationInput,
  dependencies: FinalizeRetryDependencies = defaultDependencies
) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await dependencies.finalize(input)
    } catch (error) {
      lastError = error
      console.error("[thread-chat-generation] finalize 失败", {
        generationId: input.generationId,
        attempt,
        error,
      })
      if (attempt < 3) await dependencies.delay(attempt * 150)
    }
  }
  throw lastError
}
