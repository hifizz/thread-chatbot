import type { AgentCase } from "@/evals/agent/schema"

export type RemoteEvaluationPolicy = {
  includeAuthorizedPrivate: boolean
}

export function resolveRemoteEvaluationPolicy(input: {
  includeAuthorizedPrivateRequested: boolean
  source?: Record<string, string | undefined>
}): RemoteEvaluationPolicy {
  const source = input.source ?? process.env
  return {
    includeAuthorizedPrivate:
      input.includeAuthorizedPrivateRequested &&
      source.EVAL_ALLOW_PRIVATE_REMOTE === "true",
  }
}

export function selectRemoteEligibleCases(
  cases: readonly AgentCase[],
  policy: RemoteEvaluationPolicy = { includeAuthorizedPrivate: false }
): AgentCase[] {
  return cases.filter(
    (evaluationCase) =>
      evaluationCase.sensitivity !== "authorized-private" ||
      policy.includeAuthorizedPrivate
  )
}
