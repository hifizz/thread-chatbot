import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExecutionOutput } from "@/evals/agent/result"
import { executeProductionGeneration } from "@/evals/agent/executors/production-harness"

export function executeProductionContentCase(input: {
  evaluationCase: AgentCase
  modelId: string
  traceId: string
  candidate: string
  abortSignal: AbortSignal
}): Promise<AgentExecutionOutput> {
  return executeProductionGeneration({
    evaluationCase: input.evaluationCase,
    modelId: input.modelId,
    abortSignal: input.abortSignal,
  })
}
