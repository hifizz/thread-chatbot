import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExecutionOutput } from "@/evals/agent/result"
import type { ModelAttemptRecord } from "@/lib/ai/model-attempt"

function fixtureModelAttempts(
  evaluationCase: AgentCase
): ModelAttemptRecord[] {
  return (evaluationCase.fixtureResult?.modelAttempts ?? []).map((attempt) => ({
    stepIndex: attempt.stepIndex,
    purpose: "evaluation-fixture",
    routeId: attempt.routeId,
    upstreamModelId: "fixture-model",
    adapter: "fixture",
    gateway: null,
    toolProfileId: attempt.toolProfileId,
    stableRequestPrefixHash: attempt.stableRequestPrefixHash,
    cacheStrategy: "fixture",
    cacheEligibility:
      attempt.cacheOutcome === "below-minimum" ? "below-minimum" : "eligible",
    cacheOutcome: attempt.cacheOutcome,
    usage: {
      ...(attempt.inputTokens !== undefined
        ? { inputTokens: attempt.inputTokens }
        : {}),
      ...(attempt.cacheReadTokens !== undefined
        ? { cacheReadTokens: attempt.cacheReadTokens }
        : {}),
      ...(attempt.cacheWriteTokens !== undefined
        ? { cacheWriteTokens: attempt.cacheWriteTokens }
        : {}),
      ...(attempt.costUsd !== undefined ? { costUsd: attempt.costUsd } : {}),
      source: "provider-metadata",
      complete:
        attempt.inputTokens !== undefined &&
        attempt.cacheReadTokens !== undefined &&
        attempt.cacheWriteTokens !== undefined,
    },
  }))
}

export async function executeFixtureCase(
  evaluationCase: AgentCase
): Promise<AgentExecutionOutput> {
  if (!evaluationCase.fixtureResult) {
    throw new Error(`Fixture result missing for case ${evaluationCase.id}`)
  }
  const cache = evaluationCase.fixtureResult.cache
  return {
    text: evaluationCase.fixtureResult.text,
    ...(evaluationCase.fixtureResult.route
      ? { route: evaluationCase.fixtureResult.route }
      : {}),
    tools: evaluationCase.fixtureResult.tools,
    terminalState: evaluationCase.fixtureResult.terminalState,
    usage: evaluationCase.fixtureResult.usage ?? {},
    providerAttempts: evaluationCase.fixtureResult.providerAttempts,
    modelAttempts: fixtureModelAttempts(evaluationCase),
    ...(cache
      ? {
          cache: {
            eligible: cache.eligible,
            reason: cache.reason,
            ...(cache.inputTokens !== undefined
              ? { inputTokens: cache.inputTokens }
              : {}),
            ...(cache.cacheReadTokens !== undefined
              ? { cacheReadTokens: cache.cacheReadTokens }
              : {}),
            ...(cache.cacheWriteTokens !== undefined
              ? { cacheWriteTokens: cache.cacheWriteTokens }
              : {}),
            ...(cache.costUsd !== undefined
              ? { costUsd: cache.costUsd }
              : {}),
            ...(cache.requestPrefixHash
              ? { requestPrefixHash: cache.requestPrefixHash }
              : {}),
            ...(cache.toolProfileId
              ? { toolProfileId: cache.toolProfileId }
              : {}),
            ...(cache.routeId ? { routeId: cache.routeId } : {}),
            ...(cache.quoteCount !== undefined
              ? { quoteCount: cache.quoteCount }
              : {}),
            ...(cache.metadataExcluded !== undefined
              ? { metadataExcluded: cache.metadataExcluded }
              : {}),
          },
        }
      : {}),
  }
}
