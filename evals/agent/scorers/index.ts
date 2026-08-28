import type { AgentCase } from "@/evals/agent/schema"
import type {
  AgentExperimentResult,
  EvaluationScore,
} from "@/evals/agent/result"

/** 第八任务组中的确定性与可选 judge scorer 共用此合同。 */
export type AgentScorer = (input: {
  evaluationCase: AgentCase
  result: AgentExperimentResult
}) =>
  | EvaluationScore
  | EvaluationScore[]
  | Promise<EvaluationScore | EvaluationScore[]>

export { deterministicScorer } from "@/evals/agent/scorers/deterministic"
export { searchQualityScorer } from "@/evals/agent/scorers/search"
export { memorySafetyScorer } from "@/evals/agent/scorers/memory"
