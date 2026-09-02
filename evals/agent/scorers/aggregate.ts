import type { AgentExperimentResult } from "@/evals/agent/result"

function quantile(values: number[], percentile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentile / 100) * sorted.length) - 1
  )
  return sorted[index]
}

export function aggregateEvaluationResults(results: AgentExperimentResult[]) {
  const durations = results.map((result) => result.timing.durationMs)
  const attempts = results.flatMap((result) => result.providerAttempts)
  const totalUsage = results.reduce<Record<string, number>>((usage, result) => {
    for (const [key, value] of Object.entries(result.usage)) {
      usage[key] = (usage[key] ?? 0) + value
    }
    return usage
  }, {})
  const hardFailures = results.flatMap((result) =>
    result.scores.filter(
      (score) => score.severity === "hard" && score.passed === false
    )
  ).length
  return {
    cases: results.length,
    hardFailures,
    p50LatencyMs: quantile(durations, 50),
    p95LatencyMs: quantile(durations, 95),
    totalUsage,
    toolCalls: results.reduce(
      (count, result) => count + result.output.tools.length,
      0
    ),
    providerAttempts: attempts.length,
    fallbackRate:
      attempts.length === 0
        ? 0
        : attempts.filter(
            (attempt) =>
              (typeof attempt.fallbackCount === "number" &&
                attempt.fallbackCount > 0) ||
              attempt.outcome === "fallback"
          ).length / attempts.length,
    errorRate:
      results.length === 0
        ? 0
        : results.filter((result) => result.error).length / results.length,
    emptyOutputRate:
      results.length === 0
        ? 0
        : results.filter(
            (result) =>
              !result.output.text.trim() && result.output.tools.length === 0
          ).length / results.length,
    estimatedCostUsd: totalUsage.estimatedCostUsd ?? null,
  }
}
