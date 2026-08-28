import type { AgentCase } from "@/evals/agent/schema"
import type {
  AgentExperimentResult,
  EvaluationScore,
} from "@/evals/agent/result"

/** 第八任务组中的确定性与可选 judge scorer 共用此合同。 */
export type AgentScorer = (input: {
  evaluationCase: AgentCase
  result: AgentExperimentResult
}) => EvaluationScore | EvaluationScore[]
