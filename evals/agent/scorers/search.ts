import type { AgentScorer } from "@/evals/agent/scorers"
import { binaryScore, normalizedIncludes } from "@/evals/agent/scorers/helpers"
import type { EvaluationScore } from "@/evals/agent/result"

const URL_PATTERN = /https?:\/\/[^\s)\]>]+/g

export const searchQualityScorer: AgentScorer = ({
  evaluationCase,
  result,
}) => {
  if (evaluationCase.suite !== "search-routing") return []
  const urls = result.output.text.match(URL_PATTERN) ?? []
  const scores: EvaluationScore[] = []
  if (evaluationCase.expected.citationsRequired !== undefined) {
    scores.push(
      binaryScore({
        name: "citation-presence",
        passed: !evaluationCase.expected.citationsRequired || urls.length > 0,
        severity: "quality",
      })
    )
  }
  if (evaluationCase.expected.sourceDomains) {
    const domains = urls.flatMap((url) => {
      try {
        return [new URL(url).hostname]
      } catch {
        return []
      }
    })
    scores.push(
      binaryScore({
        name: "source-domain-match",
        passed: evaluationCase.expected.sourceDomains.every((expected) =>
          domains.some(
            (domain) => domain === expected || domain.endsWith(`.${expected}`)
          )
        ),
        severity: "quality",
      })
    )
  }
  for (const fact of evaluationCase.expected.groundingFacts ?? []) {
    scores.push(
      binaryScore({
        name: `grounding:${fact}`,
        passed: normalizedIncludes(result.output.text, fact),
        severity: "quality",
      })
    )
  }
  if (evaluationCase.tags.includes("live-web")) {
    scores.push({
      name: "live-web-volatility",
      value: "variable",
      deterministic: true,
      severity: "diagnostic",
      signal: "evaluation",
      evaluatorVersion: "freshness-v1",
      comment:
        "Live Web facts are reported separately from stable routing checks.",
    })
  }
  return scores
}
