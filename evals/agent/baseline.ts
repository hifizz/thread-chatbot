import type { EvaluationCandidateConfig } from "@/evals/agent/fingerprint"
import type { AgentExperimentResult } from "@/evals/agent/result"
import { aggregateEvaluationResults } from "@/evals/agent/scorers/aggregate"

export type AgentRunSnapshot = {
  schemaVersion: "agent-run-snapshot-v1"
  runId: string
  kind: "fixture" | "live"
  createdAt: string
  datasetRevision: string
  candidateFingerprint: string
  candidate: EvaluationCandidateConfig
  experimentUrl: string | null
  aggregate: ReturnType<typeof aggregateEvaluationResults>
  cases: Array<{
    caseId: string
    suite: string
    hardFailures: string[]
    judgeScores: Record<string, number>
    latencyMs: number
    usage: Record<string, number>
    providerAttempts: number
    providerFailures?: number
    errorCategory: string | null
  }>
}

export function createAgentRunSnapshot(input: {
  runId: string
  datasetRevision: string
  candidateFingerprint: string
  candidate: EvaluationCandidateConfig
  results: AgentExperimentResult[]
  kind: AgentRunSnapshot["kind"]
  experimentUrl?: string | null
  createdAt?: string
}): AgentRunSnapshot {
  return {
    schemaVersion: "agent-run-snapshot-v1",
    runId: input.runId,
    kind: input.kind,
    createdAt: input.createdAt ?? new Date().toISOString(),
    datasetRevision: input.datasetRevision,
    candidateFingerprint: input.candidateFingerprint,
    candidate: input.candidate,
    experimentUrl: input.experimentUrl ?? null,
    aggregate: aggregateEvaluationResults(input.results),
    cases: input.results.map((result) => ({
      caseId: result.caseId,
      suite: result.suite,
      hardFailures: result.scores
        .filter((score) => score.severity === "hard" && score.passed === false)
        .map((score) => score.name),
      judgeScores: Object.fromEntries(
        result.scores
          .filter(
            (score) =>
              score.signal === "judge" && typeof score.value === "number"
          )
          .map((score) => [score.name, score.value as number])
      ),
      latencyMs: result.timing.durationMs,
      usage: result.usage,
      providerAttempts: result.providerAttempts.length,
      providerFailures: result.providerAttempts.filter(
        (attempt) =>
          typeof attempt.outcome === "string" && attempt.outcome !== "success"
      ).length,
      errorCategory: result.error?.category ?? null,
    })),
  }
}
