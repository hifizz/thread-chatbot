import type { PromptCacheUsage } from "@/lib/ai/prompt-cache-usage"

export type PromptCachePriceCard = {
  uncachedInputUsdPerMillion: number
  cacheWriteUsdPerMillion: number
  cacheReadUsdPerMillion: number
  outputUsdPerMillion: number
  gatewayOrRelayFixedUsd?: number
}

export type PromptCacheQualitySignals = {
  answerQuality: number
  quoteUnderstanding: number
  toolBehavior: number
  safetyPassed: boolean
  terminalState: "completed" | "stopped" | "failed"
}

export type PromptCacheProbeSample = {
  label: string
  routeId: string
  cacheMode: "off" | "enabled"
  ttlClass: "provider-default" | "5m" | "1h"
  usage: PromptCacheUsage
  quality: PromptCacheQualitySignals
  providerCostUsd?: number
  routeDrifted?: boolean
}

export type PromptCacheProbeDecision = {
  enable: boolean
  qualityPassed: boolean
  reason:
    | "lower-cost-no-regression"
    | "quality-regression"
    | "tool-regression"
    | "safety-regression"
    | "terminal-regression"
    | "cost-not-proven"
    | "not-cheaper"
    | "route-drift"
  baselineCostUsd?: number
  candidateCostUsd?: number
  savingsUsd?: number
  savingsRatio?: number
}

type PromptCacheProbeInput = {
  baseline: PromptCacheProbeSample
  candidate: PromptCacheProbeSample
  price: PromptCachePriceCard
}

/** Compatibility shape used by the first fake-probe script and stored fixtures. */
type LegacyPromptCacheProbeInput = {
  routeId?: string
  qualityPassed: boolean
  warmup: PromptCacheProbeSample
  reuse: PromptCacheProbeSample
  priceCard: PromptCachePriceCard
}

function validRate(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("INVALID_PROMPT_CACHE_PRICE_CARD")
  }
  return value
}

export function calculatePromptCacheCostUsd(input: {
  usage: PromptCacheUsage
  price: PromptCachePriceCard
  providerCostUsd?: number
}): number | undefined {
  if (
    typeof input.providerCostUsd === "number" &&
    Number.isFinite(input.providerCostUsd) &&
    input.providerCostUsd >= 0
  ) {
    return input.providerCostUsd
  }
  const uncachedInputTokens = input.usage.uncachedInputTokens
  const cacheWriteTokens = input.usage.cacheWriteTokens
  const cacheReadTokens = input.usage.cacheReadTokens
  const outputTokens = input.usage.outputTokens
  if (
    uncachedInputTokens === undefined ||
    cacheWriteTokens === undefined ||
    cacheReadTokens === undefined ||
    outputTokens === undefined
  ) {
    return undefined
  }
  const million = 1_000_000
  return (
    (uncachedInputTokens / million) *
      validRate(input.price.uncachedInputUsdPerMillion) +
    (cacheWriteTokens / million) *
      validRate(input.price.cacheWriteUsdPerMillion) +
    (cacheReadTokens / million) *
      validRate(input.price.cacheReadUsdPerMillion) +
    (outputTokens / million) * validRate(input.price.outputUsdPerMillion) +
    validRate(input.price.gatewayOrRelayFixedUsd ?? 0)
  )
}

function qualityRegression(
  baseline: PromptCacheQualitySignals,
  candidate: PromptCacheQualitySignals
): PromptCacheProbeDecision["reason"] | null {
  if (!candidate.safetyPassed && baseline.safetyPassed) return "safety-regression"
  if (
    candidate.terminalState !== "completed" &&
    baseline.terminalState === "completed"
  ) {
    return "terminal-regression"
  }
  if (candidate.toolBehavior < baseline.toolBehavior) return "tool-regression"
  if (
    candidate.answerQuality < baseline.answerQuality ||
    candidate.quoteUnderstanding < baseline.quoteUnderstanding
  ) {
    return "quality-regression"
  }
  return null
}

function normalizeProbeInput(
  input: PromptCacheProbeInput | LegacyPromptCacheProbeInput
): PromptCacheProbeInput & { forcedQualityFailure: boolean } {
  if ("baseline" in input) {
    return { ...input, forcedQualityFailure: false }
  }
  return {
    baseline: input.warmup,
    candidate: input.reuse,
    price: input.priceCard,
    forcedQualityFailure: !input.qualityPassed,
  }
}

export function evaluatePromptCacheProbe(
  rawInput: PromptCacheProbeInput | LegacyPromptCacheProbeInput
): PromptCacheProbeDecision {
  const input = normalizeProbeInput(rawInput)
  if (input.candidate.routeDrifted) {
    return { enable: false, qualityPassed: true, reason: "route-drift" }
  }
  if (input.forcedQualityFailure) {
    return { enable: false, qualityPassed: false, reason: "quality-regression" }
  }
  const regression = qualityRegression(
    input.baseline.quality,
    input.candidate.quality
  )
  if (regression) {
    return { enable: false, qualityPassed: false, reason: regression }
  }
  const baselineCostUsd = calculatePromptCacheCostUsd({
    usage: input.baseline.usage,
    price: input.price,
    providerCostUsd: input.baseline.providerCostUsd,
  })
  const candidateCostUsd = calculatePromptCacheCostUsd({
    usage: input.candidate.usage,
    price: input.price,
    providerCostUsd: input.candidate.providerCostUsd,
  })
  if (baselineCostUsd === undefined || candidateCostUsd === undefined) {
    return {
      enable: false,
      qualityPassed: true,
      reason: "cost-not-proven",
      ...(baselineCostUsd !== undefined ? { baselineCostUsd } : {}),
      ...(candidateCostUsd !== undefined ? { candidateCostUsd } : {}),
    }
  }
  const savingsUsd = baselineCostUsd - candidateCostUsd
  if (savingsUsd <= 0) {
    return {
      enable: false,
      qualityPassed: true,
      reason: "not-cheaper",
      baselineCostUsd,
      candidateCostUsd,
      savingsUsd,
      savingsRatio: baselineCostUsd > 0 ? savingsUsd / baselineCostUsd : 0,
    }
  }
  return {
    enable: true,
    qualityPassed: true,
    reason: "lower-cost-no-regression",
    baselineCostUsd,
    candidateCostUsd,
    savingsUsd,
    savingsRatio: baselineCostUsd > 0 ? savingsUsd / baselineCostUsd : 0,
  }
}

export const DEFAULT_FAKE_CLAUDE_PRICE_CARD: PromptCachePriceCard = {
  uncachedInputUsdPerMillion: 15,
  cacheWriteUsdPerMillion: 18.75,
  cacheReadUsdPerMillion: 1.5,
  outputUsdPerMillion: 75,
}

export function fakeClaudeCacheProbe(): {
  baseline: PromptCacheProbeSample
  candidate: PromptCacheProbeSample
  /** Compatibility aliases retained for existing scripts and fixtures. */
  warmup: PromptCacheProbeSample
  reuse: PromptCacheProbeSample
  decision: PromptCacheProbeDecision
} {
  const quality: PromptCacheQualitySignals = {
    answerQuality: 1,
    quoteUnderstanding: 1,
    toolBehavior: 1,
    safetyPassed: true,
    terminalState: "completed",
  }
  const baseline: PromptCacheProbeSample = {
    label: "fake-umapis-claude-uncached",
    routeId: "anthropic:umapis:claude",
    cacheMode: "off",
    ttlClass: "provider-default",
    usage: {
      inputTokens: 12_000,
      uncachedInputTokens: 12_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 1_000,
      source: "provider-metadata",
      complete: true,
    },
    quality,
  }
  const candidate: PromptCacheProbeSample = {
    label: "fake-umapis-claude-short-cache",
    routeId: "anthropic:umapis:claude",
    cacheMode: "enabled",
    ttlClass: "5m",
    usage: {
      inputTokens: 12_000,
      uncachedInputTokens: 1_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 11_000,
      outputTokens: 1_000,
      source: "provider-metadata",
      complete: true,
    },
    quality,
  }
  return {
    baseline,
    candidate,
    warmup: baseline,
    reuse: candidate,
    decision: evaluatePromptCacheProbe({
      baseline,
      candidate,
      price: DEFAULT_FAKE_CLAUDE_PRICE_CARD,
    }),
  }
}
