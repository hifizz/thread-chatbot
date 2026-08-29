import { classifyObservabilityError } from "@/lib/observability/error"
import type { AgentCase } from "@/evals/agent/schema"
import type {
  AgentExecutionOutput,
  AgentExperimentResult,
} from "@/evals/agent/result"
import type { EvaluationCandidateConfig } from "@/evals/agent/fingerprint"
import {
  evaluationConfigFingerprint,
  publicEvaluationConfig,
} from "@/evals/agent/fingerprint"
import { datasetRevision, evaluationTraceId } from "@/evals/agent/identity"
import {
  selectAgentCases,
  type EvaluationSelection,
} from "@/evals/agent/selection"
import { scoreAgentResult } from "@/evals/agent/scoring"
import type { AgentScorer } from "@/evals/agent/scorers"

export type EvaluationRunMode = "smoke" | "ci" | "scheduled" | "release"

const MODE_BUDGETS: Record<
  EvaluationRunMode,
  { concurrency: number; timeoutMs: number }
> = {
  smoke: { concurrency: 2, timeoutMs: 30_000 },
  ci: { concurrency: 3, timeoutMs: 60_000 },
  scheduled: { concurrency: 2, timeoutMs: 180_000 },
  release: { concurrency: 1, timeoutMs: 300_000 },
}

export type AgentCaseExecutor = (input: {
  evaluationCase: AgentCase
  traceId: string
  candidate: EvaluationCandidateConfig
}) => Promise<AgentExecutionOutput>

export type RunAgentEvaluationOptions = {
  runId?: string
  mode: EvaluationRunMode
  candidate: EvaluationCandidateConfig
  selection?: EvaluationSelection
  executor: AgentCaseExecutor
  concurrency?: number
  timeoutMs?: number
  scorers?: AgentScorer[]
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`Evaluation case exceeded ${timeoutMs}ms`)
          error.name = "TimeoutError"
          reject(error)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function runAgentEvaluation(
  cases: readonly AgentCase[],
  options: RunAgentEvaluationOptions
): Promise<{
  runId: string
  datasetRevision: string
  candidateFingerprint: string
  candidate: EvaluationCandidateConfig
  results: AgentExperimentResult[]
}> {
  const modeCases =
    options.selection ||
    options.mode === "scheduled" ||
    options.mode === "release"
      ? cases
      : cases.filter((item) =>
          options.mode === "smoke"
            ? item.tags.includes("smoke")
            : item.tags.includes("smoke") || item.tags.includes("ci")
        )
  const selected = selectAgentCases(modeCases, options.selection)
  const runId = options.runId ?? crypto.randomUUID()
  const revision = datasetRevision(cases)
  const candidate = publicEvaluationConfig(options.candidate)
  const fingerprint = evaluationConfigFingerprint(candidate)
  const budget = MODE_BUDGETS[options.mode]
  const concurrency = Math.max(
    1,
    Math.floor(options.concurrency ?? budget.concurrency)
  )
  const timeoutMs = options.timeoutMs ?? budget.timeoutMs
  const results = new Array<AgentExperimentResult>(selected.length)
  let cursor = 0

  const worker = async () => {
    while (cursor < selected.length) {
      const index = cursor++
      const evaluationCase = selected[index]
      const traceId = await evaluationTraceId({
        runId,
        caseId: evaluationCase.id,
        candidateFingerprint: fingerprint,
        datasetRevision: revision,
      })
      const started = Date.now()
      const startedAt = new Date(started).toISOString()
      let output: AgentExecutionOutput
      let error: AgentExperimentResult["error"]
      try {
        output = await withTimeout(
          options.executor({ evaluationCase, traceId, candidate }),
          timeoutMs
        )
      } catch (cause) {
        output = { text: "", tools: [], terminalState: "failed" }
        error = {
          category: classifyObservabilityError(cause),
          message: cause instanceof Error ? cause.name : "UnknownError",
        }
      }
      const ended = Date.now()
      const result: AgentExperimentResult = {
        schemaVersion: "agent-result-v1",
        runId,
        caseId: evaluationCase.id,
        suite: evaluationCase.suite,
        candidate: candidate.candidate,
        candidateFingerprint: fingerprint,
        datasetRevision: revision,
        traceId: output.traceId ?? traceId,
        output: {
          text: output.text,
          ...(output.route ? { route: output.route } : {}),
          tools: output.tools ?? [],
          terminalState: output.terminalState ?? "completed",
        },
        timing: {
          startedAt,
          endedAt: new Date(ended).toISOString(),
          durationMs: ended - started,
        },
        usage: output.usage ?? {},
        providerAttempts: output.providerAttempts ?? [],
        scores: [],
        ...(error ? { error } : {}),
      }
      results[index] = await scoreAgentResult({
        evaluationCase,
        result,
        ...(options.scorers ? { scorers: options.scorers } : {}),
      })
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, selected.length) }, worker)
  )
  return {
    runId,
    datasetRevision: revision,
    candidateFingerprint: fingerprint,
    candidate,
    results,
  }
}

export function evaluationModeBudget(mode: EvaluationRunMode) {
  return { ...MODE_BUDGETS[mode] }
}
