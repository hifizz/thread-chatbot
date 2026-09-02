import type { AgentScorer } from "@/evals/agent/scorers"
import { binaryScore, normalizedIncludes } from "@/evals/agent/scorers/helpers"

export const deterministicScorer: AgentScorer = ({
  evaluationCase,
  result,
}) => {
  const expected = evaluationCase.expected
  const scores = [
    binaryScore({
      name: "execution-success",
      passed: expected.errorCategory
        ? result.error?.category === expected.errorCategory
        : !result.error,
      severity: "hard",
    }),
    binaryScore({
      name: "non-empty-output",
      passed:
        result.output.terminalState !== "completed" ||
        result.output.text.trim().length > 0 ||
        result.output.tools.length > 0,
      severity: "hard",
    }),
  ]
  if (expected.terminalState) {
    scores.push(
      binaryScore({
        name: "terminal-state",
        passed: result.output.terminalState === expected.terminalState,
        severity: "hard",
      })
    )
  }
  if (expected.route) {
    scores.push(
      binaryScore({
        name: "expected-route",
        passed: result.output.route === expected.route,
        severity: "hard",
      })
    )
  }
  if (expected.tools) {
    scores.push(
      binaryScore({
        name: "expected-tools",
        passed:
          expected.tools.every((tool) => result.output.tools.includes(tool)) &&
          result.output.tools.every((tool) => expected.tools!.includes(tool)),
        severity: "hard",
      })
    )
  }
  if (expected.maxToolCount !== undefined) {
    scores.push(
      binaryScore({
        name: "tool-count-budget",
        passed: result.output.tools.length <= expected.maxToolCount,
        severity: "hard",
      })
    )
  }
  for (const value of expected.contains ?? []) {
    scores.push(
      binaryScore({
        name: `contains:${value}`,
        passed: normalizedIncludes(result.output.text, value),
        severity: "quality",
      })
    )
  }
  for (const value of expected.excludes ?? []) {
    scores.push(
      binaryScore({
        name: `excludes:${value}`,
        passed: !normalizedIncludes(result.output.text, value),
        severity: "hard",
      })
    )
  }
  if (expected.jsonKeys) {
    let value: unknown
    try {
      value = JSON.parse(result.output.text)
    } catch {
      value = null
    }
    const record =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null
    scores.push(
      binaryScore({
        name: "output-schema",
        passed: Boolean(
          record && expected.jsonKeys.every((key) => key in record)
        ),
        severity: "hard",
      })
    )
  }
  if (expected.fallbackExpected !== undefined) {
    const usedFallback = result.providerAttempts.some(
      (attempt) =>
        (typeof attempt.fallbackCount === "number" &&
          attempt.fallbackCount > 0) ||
        attempt.outcome === "fallback"
    )
    scores.push(
      binaryScore({
        name: "provider-fallback",
        passed: usedFallback === expected.fallbackExpected,
        severity: "hard",
      })
    )
  }
  return scores
}
