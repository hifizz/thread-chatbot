import {
  selectPromptCacheBreakpoints,
  type PromptCacheBoundaryCandidate,
  type PromptCacheTtlClass,
  type PromptProviderOptions,
} from "@/lib/ai/prompt-cache"
import type { PromptCacheStrategy } from "@/lib/ai/provider"

export type PromptCacheMarker = {
  boundary: "kernel-end" | "inherited-end" | "branch-history-end"
  tokenEstimate: number
  providerOptions: PromptProviderOptions
}

export type PromptCacheAdapterPlan = {
  strategy: PromptCacheStrategy
  enabled: boolean
  markers: PromptCacheMarker[]
  providerOptions?: PromptProviderOptions
  reason: string
}

function anthropicMarkerOptions(
  ttl: PromptCacheTtlClass
): PromptProviderOptions {
  return {
    anthropic: {
      cacheControl: {
        type: "ephemeral",
        ...(ttl === "provider-default" ? {} : { ttl }),
      },
    },
  }
}

/**
 * Pure adapter plan used by fake tests and by verified provider adapters later.
 * Probe-required/unsupported routes always return disabled and never guess fields.
 */
export function buildPromptCacheAdapterPlan(input: {
  strategy: PromptCacheStrategy
  candidates: readonly PromptCacheBoundaryCandidate[]
  minimumPrefixTokens: number
  maximumBreakpoints?: number
  ttlClass: PromptCacheTtlClass
}): PromptCacheAdapterPlan {
  switch (input.strategy) {
    case "probe-required":
    case "unsupported":
      return {
        strategy: input.strategy,
        enabled: false,
        markers: [],
        reason: input.strategy,
      }
    case "implicit":
      return {
        strategy: input.strategy,
        enabled: true,
        markers: [],
        reason: "implicit-provider-cache",
      }
    case "gateway-auto":
      return {
        strategy: input.strategy,
        enabled: true,
        markers: [],
        providerOptions: { gateway: { caching: "auto" } },
        reason: "gateway-auto",
      }
    case "explicit-breakpoint": {
      const selected = selectPromptCacheBreakpoints({
        candidates: input.candidates,
        minimumPrefixTokens: input.minimumPrefixTokens,
        maximumBreakpoints: input.maximumBreakpoints ?? 1,
      })
      return {
        strategy: input.strategy,
        enabled: selected.length > 0,
        markers: selected.map((boundary) => ({
          boundary: boundary.kind,
          tokenEstimate: boundary.tokenEstimate,
          providerOptions: anthropicMarkerOptions(input.ttlClass),
        })),
        reason:
          selected.length > 0 ? "explicit-breakpoints-selected" : "below-minimum",
      }
    }
  }
}
