import type { PromptManifest } from "@/lib/thread-chat/application/prompt-compiler"

export const PROMPT_CACHE_OBSERVABILITY_KEYS = [
  "promptCompilerVersion",
  "agentKernelVersion",
  "quoteProtocolVersion",
  "quoteModelFormatVersion",
  "quoteBudgetPolicyVersion",
  "promptCacheProfileVersion",
  "toolProfileVersion",
  "toolProfileId",
  "toolProfileHash",
  "providerRouteId",
  "stablePrefixHash",
  "forkContextHash",
  "cacheEligibility",
  "cacheMode",
  "cacheTtlClass",
  "stablePrefixCharacters",
  "stablePrefixTokenEstimate",
  "currentUserQuoteCount",
  "cacheFallbackUsed",
  "modelAttemptCount",
  "inputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheReadRatio",
  "providerHitCount",
] as const

export type PromptCacheObservabilityKey =
  (typeof PROMPT_CACHE_OBSERVABILITY_KEYS)[number]

export type PromptCacheObservabilityMetadata = Partial<
  Record<PromptCacheObservabilityKey, string | number | boolean>
>

export function buildPromptCacheObservabilityMetadata(input: {
  manifest?: PromptManifest
  cacheSummary?: Record<string, unknown>
  cacheFallbackUsed?: boolean
  modelAttemptCount?: number
}): PromptCacheObservabilityMetadata {
  const manifest = input.manifest
  const candidates: Record<string, unknown> = {
    ...(manifest
      ? {
          promptCompilerVersion: manifest.promptCompilerVersion,
          agentKernelVersion: manifest.agentKernelVersion,
          quoteProtocolVersion: manifest.quoteProtocolVersion,
          quoteModelFormatVersion: manifest.quoteModelFormatVersion,
          quoteBudgetPolicyVersion: manifest.quoteBudgetPolicyVersion,
          promptCacheProfileVersion: manifest.promptCacheProfileVersion,
          toolProfileVersion: manifest.toolProfileVersion,
          toolProfileId: manifest.toolProfileId,
          toolProfileHash: manifest.toolProfileHash,
          providerRouteId: manifest.routeId,
          stablePrefixHash: manifest.stableRequestPrefixHash,
          forkContextHash: manifest.forkContextHash,
          cacheEligibility: manifest.cacheEligibility.reason,
          cacheMode: manifest.cacheMode,
          cacheTtlClass: manifest.ttlClass,
          stablePrefixCharacters: manifest.stablePrefixCharacters,
          stablePrefixTokenEstimate: manifest.stablePrefixTokenEstimate,
          currentUserQuoteCount: manifest.currentUserQuoteCount,
        }
      : {}),
    ...(input.cacheSummary ?? {}),
    cacheFallbackUsed: input.cacheFallbackUsed === true,
    modelAttemptCount: input.modelAttemptCount ?? 0,
  }
  return Object.fromEntries(
    PROMPT_CACHE_OBSERVABILITY_KEYS.flatMap((key) => {
      const value = candidates[key]
      return typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
        ? [[key, value]]
        : []
    })
  ) as PromptCacheObservabilityMetadata
}
