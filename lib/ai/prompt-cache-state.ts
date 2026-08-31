import type { PromptCacheUsage } from "@/lib/ai/prompt-cache-usage"
import type { ModelAttemptCacheOutcome } from "@/lib/ai/model-attempt"

export type PromptCacheWarmthInput = {
  eligible: boolean
  belowMinimum?: boolean
  currentRouteId: string
  previousRouteId?: string
  prefixPreviouslySubmittedAt?: Date
  now?: Date
  ttlMs?: number
  latestAssistantWasPreviouslyInput?: boolean
  usage: PromptCacheUsage
}

export type PromptCacheState = {
  outcome: ModelAttemptCacheOutcome
  reason: string
  providerEvidence: "hit" | "miss" | "unavailable"
}

export function inferPromptCacheState(
  input: PromptCacheWarmthInput
): PromptCacheState {
  if (!input.eligible || input.belowMinimum) {
    return {
      outcome: "below-minimum",
      reason: "stable-prefix-below-route-minimum",
      providerEvidence: "unavailable",
    }
  }
  if (
    input.previousRouteId &&
    input.previousRouteId !== input.currentRouteId
  ) {
    return {
      outcome: "route-drift",
      reason: "actual-provider-route-changed",
      providerEvidence: "unavailable",
    }
  }
  if ((input.usage.cacheReadTokens ?? 0) > 0) {
    return {
      outcome: "provider-hit",
      reason: "provider-reported-cache-read",
      providerEvidence: "hit",
    }
  }
  if (input.usage.cacheReadTokens === 0) {
    return {
      outcome: "provider-miss",
      reason: "provider-reported-zero-cache-read",
      providerEvidence: "miss",
    }
  }
  if (!input.prefixPreviouslySubmittedAt) {
    return {
      outcome:
        input.latestAssistantWasPreviouslyInput === false
          ? "partial-warm"
          : "cold-start",
      reason:
        input.latestAssistantWasPreviouslyInput === false
          ? "latest-assistant-not-yet-used-as-input"
          : "no-known-prior-identical-input",
      providerEvidence: "unavailable",
    }
  }
  if (
    input.ttlMs !== undefined &&
    (input.now ?? new Date()).getTime() -
      input.prefixPreviouslySubmittedAt.getTime() >=
      input.ttlMs
  ) {
    return {
      outcome: "ttl-expired",
      reason: "known-prefix-older-than-ttl",
      providerEvidence: "unavailable",
    }
  }
  return {
    outcome: "usage-unavailable",
    reason: "eligible-warmth-possible-provider-usage-missing",
    providerEvidence: "unavailable",
  }
}
