import type { EvaluationScore } from "@/evals/agent/result"

export function binaryScore(input: {
  name: string
  passed: boolean
  severity: EvaluationScore["severity"]
  comment?: string
}): EvaluationScore {
  return {
    name: input.name,
    value: input.passed ? 1 : 0,
    passed: input.passed,
    deterministic: true,
    severity: input.severity,
    signal: "evaluation",
    evaluatorVersion: "deterministic-v1",
    ...(input.comment ? { comment: input.comment } : {}),
  }
}

export function normalizedIncludes(text: string, expected: string): boolean {
  return text.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
}
