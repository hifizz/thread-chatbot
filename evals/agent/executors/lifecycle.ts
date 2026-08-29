import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExecutionOutput } from "@/evals/agent/result"
import { executeProductionGeneration } from "@/evals/agent/executors/production-harness"

function completedStream(text: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "start" })
      controller.enqueue({ type: "text-start", id: "eval-text" })
      controller.enqueue({ type: "text-delta", id: "eval-text", text })
      controller.enqueue({ type: "text-end", id: "eval-text" })
      controller.enqueue({
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      })
      controller.close()
    },
  })
}

function failedStream() {
  return new ReadableStream({
    start(controller) {
      controller.error(new Error("synthetic lifecycle failure"))
    },
  })
}

export async function executeLifecycleCase(input: {
  evaluationCase: AgentCase
  modelId: string
  abortSignal: AbortSignal
}): Promise<AgentExecutionOutput> {
  const scenario = input.evaluationCase.input.lifecycleScenario ?? "complete"
  return executeProductionGeneration({
    evaluationCase: input.evaluationCase,
    modelId: input.modelId,
    abortSignal: input.abortSignal,
    prepare: async () => ({
      textStream:
        scenario === "fail"
          ? failedStream()
          : completedStream(
              input.evaluationCase.fixtureResult?.text ??
                "synthetic lifecycle output"
            ),
      usage: Promise.resolve({
        inputTokens: 4,
        inputTokenDetails: {
          noCacheTokens: 4,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokens: 3,
        outputTokenDetails: { textTokens: 3, reasoningTokens: 0 },
        totalTokens: 7,
      }),
    }),
  })
}
