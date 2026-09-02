import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExperimentResult } from "@/evals/agent/result"
import type { AgentScorer } from "@/evals/agent/scorers"
import {
  deterministicScorer,
  memorySafetyScorer,
  searchQualityScorer,
} from "@/evals/agent/scorers"

export const DEFAULT_AGENT_SCORERS: AgentScorer[] = [
  deterministicScorer,
  searchQualityScorer,
  memorySafetyScorer,
]

export async function scoreAgentResult(input: {
  evaluationCase: AgentCase
  result: AgentExperimentResult
  scorers?: AgentScorer[]
}): Promise<AgentExperimentResult> {
  const scores = []
  for (const scorer of input.scorers ?? DEFAULT_AGENT_SCORERS) {
    const scored = await scorer({
      evaluationCase: input.evaluationCase,
      result: input.result,
    })
    scores.push(...(Array.isArray(scored) ? scored : [scored]))
  }
  return { ...input.result, scores }
}

export function hasHardEvaluationFailure(result: AgentExperimentResult) {
  return result.scores.some(
    (score) => score.severity === "hard" && score.passed === false
  )
}
