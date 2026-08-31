import {
  aggregatePromptCacheUsage,
  normalizePromptCacheUsage,
  type PromptCacheUsage,
} from "@/lib/ai/prompt-cache-usage"

export type ModelAttemptCacheOutcome =
  | "eligible"
  | "cold-start"
  | "partial-warm"
  | "provider-hit"
  | "provider-miss"
  | "usage-unavailable"
  | "route-drift"
  | "ttl-expired"
  | "below-minimum"

export type ModelAttemptRecord = {
  stepIndex: number
  purpose: string
  routeId: string
  upstreamModelId: string
  adapter: string
  gateway: string | null
  finishReason?: string
  durationMs?: number
  ttftMs?: number
  toolProfileId: string
  stableRequestPrefixHash: string
  cacheStrategy: string
  cacheEligibility: string
  cacheOutcome: ModelAttemptCacheOutcome
  usage: PromptCacheUsage
}

export type ModelAttemptSummary = {
  attemptCount: number
  usage: PromptCacheUsage
  cacheOutcome: "provider-hit" | "provider-miss" | "usage-unavailable"
  ttftMs?: number
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function stringField(value: unknown, key: string): string | undefined {
  const object = record(value)
  return object && typeof object[key] === "string"
    ? (object[key] as string)
    : undefined
}

export function classifyCacheOutcome(input: {
  eligibility: string
  usage: PromptCacheUsage
}): ModelAttemptCacheOutcome {
  if (input.eligibility === "below-minimum") return "below-minimum"
  if ((input.usage.cacheReadTokens ?? 0) > 0) return "provider-hit"
  if (input.usage.cacheReadTokens === 0) return "provider-miss"
  return "usage-unavailable"
}

export function createModelAttemptCollector(input: {
  purpose: string
  routeId: string
  upstreamModelId: string
  adapter: string
  gateway: string | null
  toolProfileId: string
  stableRequestPrefixHash: string
  cacheStrategy: string
  cacheEligibility: string
}) {
  const attempts: ModelAttemptRecord[] = []
  const startedAt = Date.now()
  let firstChunkTtftMs: number | undefined

  const snapshot = (): ModelAttemptRecord[] =>
    attempts.map((attempt, index) => ({
      ...attempt,
      ...(index === 0 && firstChunkTtftMs !== undefined
        ? { ttftMs: firstChunkTtftMs }
        : {}),
      usage: { ...attempt.usage },
    }))

  return {
    setTtftMs(value: number | undefined) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        firstChunkTtftMs = value
      }
    },
    recordStep(step: unknown) {
      try {
        const object = record(step)
        const usage = normalizePromptCacheUsage({
          usage: object?.usage,
          providerMetadata: object?.providerMetadata,
        })
        const finishReason = stringField(step, "finishReason")
        attempts.push({
          stepIndex: attempts.length,
          purpose: input.purpose,
          routeId: input.routeId,
          upstreamModelId: input.upstreamModelId,
          adapter: input.adapter,
          gateway: input.gateway,
          ...(finishReason ? { finishReason } : {}),
          durationMs: Math.max(0, Date.now() - startedAt),
          toolProfileId: input.toolProfileId,
          stableRequestPrefixHash: input.stableRequestPrefixHash,
          cacheStrategy: input.cacheStrategy,
          cacheEligibility: input.cacheEligibility,
          cacheOutcome: classifyCacheOutcome({
            eligibility: input.cacheEligibility,
            usage,
          }),
          usage,
        })
      } catch {
        attempts.push({
          stepIndex: attempts.length,
          purpose: input.purpose,
          routeId: input.routeId,
          upstreamModelId: input.upstreamModelId,
          adapter: input.adapter,
          gateway: input.gateway,
          durationMs: Math.max(0, Date.now() - startedAt),
          toolProfileId: input.toolProfileId,
          stableRequestPrefixHash: input.stableRequestPrefixHash,
          cacheStrategy: input.cacheStrategy,
          cacheEligibility: input.cacheEligibility,
          cacheOutcome: "usage-unavailable",
          usage: { source: "unavailable", complete: false },
        })
      }
    },
    snapshot,
    summary(): ModelAttemptSummary {
      const current = snapshot()
      const usage = aggregatePromptCacheUsage(
        current.map((attempt) => attempt.usage)
      )
      return {
        attemptCount: current.length,
        usage,
        cacheOutcome: current.some(
          (attempt) => attempt.cacheOutcome === "provider-hit"
        )
          ? "provider-hit"
          : current.some(
                (attempt) => attempt.cacheOutcome === "provider-miss"
              )
            ? "provider-miss"
            : "usage-unavailable",
        ...(firstChunkTtftMs !== undefined ? { ttftMs: firstChunkTtftMs } : {}),
      }
    },
  }
}
