import type { AgentScorer } from "@/evals/agent/scorers"
import type { EvaluationScore } from "@/evals/agent/result"

const VERSION = "prompt-cache-scorer-v1"

function score(input: {
  name: string
  passed: boolean
  value: number | string
  severity?: EvaluationScore["severity"]
  comment?: string
}): EvaluationScore {
  return {
    name: input.name,
    value: input.value,
    deterministic: true,
    severity: input.severity ?? "diagnostic",
    signal: "evaluation",
    passed: input.passed,
    ...(input.comment ? { comment: input.comment } : {}),
    evaluatorVersion: VERSION,
  }
}

export const promptCacheScorer: AgentScorer = ({
  evaluationCase,
  result,
}) => {
  const expected = evaluationCase.expected
  const scores: EvaluationScore[] = []

  if (expected.cacheEligible !== undefined) {
    const actual = result.cache?.eligible
    scores.push(
      score({
        name: "cache-eligibility",
        passed: actual === expected.cacheEligible,
        value: actual === undefined ? "unavailable" : String(actual),
        severity: "hard",
      })
    )
  }

  if (expected.cacheOutcome) {
    const outcomes = result.modelAttempts.map((attempt) => attempt.cacheOutcome)
    const passed = outcomes.includes(expected.cacheOutcome)
    scores.push(
      score({
        name: "cache-outcome",
        passed,
        value: outcomes.join(",") || "unavailable",
        severity:
          expected.cacheOutcome === "provider-hit" ? "diagnostic" : "hard",
      })
    )
  }

  if (expected.prefixHash) {
    const actual = result.cache?.requestPrefixHash
    scores.push(
      score({
        name: "stable-prefix-hash",
        passed: actual === expected.prefixHash,
        value: actual ?? "unavailable",
        severity: "hard",
      })
    )
  }

  if (expected.quoteCount !== undefined) {
    const actual = result.cache?.quoteCount
    scores.push(
      score({
        name: "quote-count",
        passed: actual === expected.quoteCount,
        value: actual ?? "unavailable",
        severity: "hard",
      })
    )
  }

  if (expected.metadataExcluded !== undefined) {
    const actual = result.cache?.metadataExcluded
    scores.push(
      score({
        name: "quote-metadata-excluded",
        passed: actual === expected.metadataExcluded,
        value: actual === undefined ? "unavailable" : String(actual),
        severity: "hard",
      })
    )
  }

  const inputTokens = result.cache?.inputTokens
  const cacheReadTokens = result.cache?.cacheReadTokens
  if (inputTokens !== undefined && cacheReadTokens !== undefined) {
    const ratio = inputTokens > 0 ? cacheReadTokens / inputTokens : 0
    scores.push(
      score({
        name: "cache-read-ratio",
        passed: ratio >= 0,
        value: ratio,
      })
    )
  }

  if (result.cache?.costUsd !== undefined) {
    scores.push(
      score({
        name: "cache-cost-usd",
        passed: result.cache.costUsd >= 0,
        value: result.cache.costUsd,
      })
    )
  }

  return scores.length > 0
    ? scores
    : score({
        name: "cache-signals-not-requested",
        passed: true,
        value: "not-applicable",
      })
}
