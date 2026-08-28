import type { AgentRunSnapshot } from "@/evals/agent/baseline"

type CaseDelta = {
  caseId: string
  suite: string
  newHardFailures: string[]
  resolvedHardFailures: string[]
  latencyDeltaMs: number
  usageDelta: Record<string, number>
  judgeDelta: Record<string, number>
  providerAttemptDelta: number
  providerFailureDelta: number
  errorChanged: boolean
}

function numericDelta(
  baseline: Record<string, number>,
  candidate: Record<string, number>
) {
  return Object.fromEntries(
    [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])]
      .sort()
      .map((key) => [key, (candidate[key] ?? 0) - (baseline[key] ?? 0)])
  )
}

export function compareAgentRuns(
  baseline: AgentRunSnapshot,
  candidate: AgentRunSnapshot
) {
  const baselineById = new Map(
    baseline.cases.map((item) => [item.caseId, item])
  )
  const deltas: CaseDelta[] = candidate.cases.flatMap((item) => {
    const previous = baselineById.get(item.caseId)
    if (!previous) return []
    return [
      {
        caseId: item.caseId,
        suite: item.suite,
        newHardFailures: item.hardFailures.filter(
          (failure) => !previous.hardFailures.includes(failure)
        ),
        resolvedHardFailures: previous.hardFailures.filter(
          (failure) => !item.hardFailures.includes(failure)
        ),
        latencyDeltaMs: item.latencyMs - previous.latencyMs,
        usageDelta: numericDelta(previous.usage, item.usage),
        judgeDelta: numericDelta(previous.judgeScores, item.judgeScores),
        providerAttemptDelta: item.providerAttempts - previous.providerAttempts,
        providerFailureDelta:
          (item.providerFailures ?? 0) - (previous.providerFailures ?? 0),
        errorChanged: item.errorCategory !== previous.errorCategory,
      },
    ]
  })
  const configKeys = [
    ...new Set([
      ...Object.keys(baseline.candidate),
      ...Object.keys(candidate.candidate),
    ]),
  ].sort()
  const configurationDelta = Object.fromEntries(
    configKeys.flatMap((key) => {
      const before = baseline.candidate[key]
      const after = candidate.candidate[key]
      return JSON.stringify(before) === JSON.stringify(after)
        ? []
        : [[key, { baseline: before, candidate: after }]]
    })
  )
  const suiteSummary = Object.values(
    deltas.reduce<
      Record<
        string,
        {
          suite: string
          cases: number
          newHardFailures: number
          errorsChanged: number
        }
      >
    >((summary, delta) => {
      const suite = (summary[delta.suite] ??= {
        suite: delta.suite,
        cases: 0,
        newHardFailures: 0,
        errorsChanged: 0,
      })
      suite.cases += 1
      suite.newHardFailures += delta.newHardFailures.length
      suite.errorsChanged += delta.errorChanged ? 1 : 0
      return summary
    }, {})
  )
  return {
    schemaVersion: "agent-comparison-v1" as const,
    baselineFingerprint: baseline.candidateFingerprint,
    candidateFingerprint: candidate.candidateFingerprint,
    datasetRevisionChanged:
      baseline.datasetRevision !== candidate.datasetRevision,
    configurationDelta,
    aggregateDelta: {
      hardFailures:
        candidate.aggregate.hardFailures - baseline.aggregate.hardFailures,
      p50LatencyMs:
        candidate.aggregate.p50LatencyMs - baseline.aggregate.p50LatencyMs,
      p95LatencyMs:
        candidate.aggregate.p95LatencyMs - baseline.aggregate.p95LatencyMs,
      totalUsage: numericDelta(
        baseline.aggregate.totalUsage,
        candidate.aggregate.totalUsage
      ),
      fallbackRate:
        candidate.aggregate.fallbackRate - baseline.aggregate.fallbackRate,
      errorRate: candidate.aggregate.errorRate - baseline.aggregate.errorRate,
      emptyOutputRate:
        candidate.aggregate.emptyOutputRate -
        baseline.aggregate.emptyOutputRate,
      estimatedCostUsd:
        (candidate.aggregate.estimatedCostUsd ?? 0) -
        (baseline.aggregate.estimatedCostUsd ?? 0),
    },
    suiteSummary,
    cases: deltas,
    blockingRegressions: deltas.flatMap((delta) =>
      delta.newHardFailures.map((failure) => ({
        caseId: delta.caseId,
        suite: delta.suite,
        failure,
      }))
    ),
  }
}

export function formatAgentComparisonMarkdown(
  comparison: ReturnType<typeof compareAgentRuns>
): string {
  return [
    "# Agent evaluation comparison",
    "",
    `- Baseline fingerprint: \`${comparison.baselineFingerprint}\``,
    `- Candidate fingerprint: \`${comparison.candidateFingerprint}\``,
    `- Dataset revision changed: ${comparison.datasetRevisionChanged}`,
    `- Blocking regressions: ${comparison.blockingRegressions.length}`,
    "",
    "## Suite summary",
    "",
    "| Suite | Cases | New hard failures | Error changes |",
    "| --- | ---: | ---: | ---: |",
    ...comparison.suiteSummary.map(
      (suite) =>
        `| ${suite.suite} | ${suite.cases} | ${suite.newHardFailures} | ${suite.errorsChanged} |`
    ),
    "",
    "## Blocking regressions",
    "",
    ...(comparison.blockingRegressions.length
      ? comparison.blockingRegressions.map(
          (failure) =>
            `- \`${failure.caseId}\` (${failure.suite}): ${failure.failure}`
        )
      : ["None."]),
    "",
    "## Aggregate delta",
    "",
    "```json",
    JSON.stringify(comparison.aggregateDelta, null, 2),
    "```",
    "",
    "## Configuration delta",
    "",
    "```json",
    JSON.stringify(comparison.configurationDelta, null, 2),
    "```",
  ].join("\n")
}
