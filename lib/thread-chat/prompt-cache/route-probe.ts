import { createHash } from "node:crypto"
import type { PromptCacheUsage } from "@/lib/thread-chat/prompt-cache/usage"

export type PromptCacheProbeEvidence =
  | "documented"
  | "fake-verified"
  | "live-verified"
  | "unverified"

export interface PromptCacheRouteProbeRecord {
  routeClass:
    | "vercel-gateway"
    | "openrouter"
    | "umapis-claude"
    | "private-relay"
    | "ark"
    | "minimax"
    | "cloudflare-compatible"
    | "direct-openai"
    | "direct-anthropic"
  initialState: "supported" | "probe-required" | "unsupported"
  evidence: PromptCacheProbeEvidence
  supportsExplicitMarker: boolean | null
  supportsAffinity: boolean | null
  supportsReadUsage: boolean | null
  supportsWriteUsage: boolean | null
  supportedTtls: readonly ("provider-default" | "5m" | "1h")[]
  notes: string
}

export const PROMPT_CACHE_ROUTE_PROBE_TABLE: readonly PromptCacheRouteProbeRecord[] = [
  {
    routeClass: "vercel-gateway",
    initialState: "supported",
    evidence: "documented",
    supportsExplicitMarker: null,
    supportsAffinity: false,
    supportsReadUsage: true,
    supportsWriteUsage: true,
    supportedTtls: ["provider-default"],
    notes: "Use gateway auto caching only in enabled rollout mode.",
  },
  {
    routeClass: "openrouter",
    initialState: "supported",
    evidence: "documented",
    supportsExplicitMarker: true,
    supportsAffinity: true,
    supportsReadUsage: true,
    supportsWriteUsage: true,
    supportedTtls: ["provider-default", "5m"],
    notes: "Actual upstream endpoint and model family still determine cache behavior.",
  },
  {
    routeClass: "umapis-claude",
    initialState: "probe-required",
    evidence: "unverified",
    supportsExplicitMarker: null,
    supportsAffinity: null,
    supportsReadUsage: null,
    supportsWriteUsage: null,
    supportedTtls: ["provider-default"],
    notes: "First live target; remains disabled until passthrough, usage and net savings are proven.",
  },
  {
    routeClass: "private-relay",
    initialState: "probe-required",
    evidence: "unverified",
    supportsExplicitMarker: null,
    supportsAffinity: null,
    supportsReadUsage: null,
    supportsWriteUsage: null,
    supportedTtls: ["provider-default"],
    notes: "OpenAI-compatible transport does not prove upstream cache support.",
  },
  {
    routeClass: "ark",
    initialState: "probe-required",
    evidence: "unverified",
    supportsExplicitMarker: null,
    supportsAffinity: null,
    supportsReadUsage: null,
    supportsWriteUsage: null,
    supportedTtls: ["provider-default"],
    notes: "Coding Plan route requires a dedicated probe.",
  },
  {
    routeClass: "minimax",
    initialState: "probe-required",
    evidence: "unverified",
    supportsExplicitMarker: null,
    supportsAffinity: null,
    supportsReadUsage: null,
    supportsWriteUsage: null,
    supportedTtls: ["provider-default"],
    notes: "No cache claims without provider evidence.",
  },
  {
    routeClass: "cloudflare-compatible",
    initialState: "probe-required",
    evidence: "unverified",
    supportsExplicitMarker: null,
    supportsAffinity: null,
    supportsReadUsage: null,
    supportsWriteUsage: null,
    supportedTtls: ["provider-default"],
    notes: "Compatibility endpoint may alter fields and routing.",
  },
  {
    routeClass: "direct-openai",
    initialState: "supported",
    evidence: "documented",
    supportsExplicitMarker: false,
    supportsAffinity: false,
    supportsReadUsage: true,
    supportsWriteUsage: false,
    supportedTtls: ["provider-default"],
    notes: "Implicit prefix caching; usage evidence remains the hit authority.",
  },
  {
    routeClass: "direct-anthropic",
    initialState: "probe-required",
    evidence: "unverified",
    supportsExplicitMarker: true,
    supportsAffinity: false,
    supportsReadUsage: true,
    supportsWriteUsage: true,
    supportedTtls: ["provider-default", "5m"],
    notes: "Reference probe only when direct credentials are explicitly configured.",
  },
] as const

export interface PromptCacheProbeRequest {
  stablePrefix: string
  dynamicTail: string
}

export interface PromptCacheProbeResponse {
  text: string
  usage: PromptCacheUsage
  finishReason: string
}

export interface PromptCacheProbeAdapter {
  routeId: string
  invoke(request: PromptCacheProbeRequest): Promise<PromptCacheProbeResponse>
}

export interface PromptCacheProbeResult {
  routeId: string
  warmup: PromptCacheProbeResponse
  reuse: PromptCacheProbeResponse
  outputEquivalent: boolean
  cacheReadProven: boolean
  totalCostReduced: boolean | null
  enableRecommended: boolean
  reason:
    | "verified-cheaper"
    | "quality-regression"
    | "cache-read-unproven"
    | "cost-unavailable"
    | "not-cheaper"
}

function outputFingerprint(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex")
}

export async function runPromptCacheProbe(input: {
  adapter: PromptCacheProbeAdapter
  stablePrefix: string
  warmupTail: string
  reuseTail: string
}): Promise<PromptCacheProbeResult> {
  const warmup = await input.adapter.invoke({
    stablePrefix: input.stablePrefix,
    dynamicTail: input.warmupTail,
  })
  const reuse = await input.adapter.invoke({
    stablePrefix: input.stablePrefix,
    dynamicTail: input.reuseTail,
  })
  const outputEquivalent =
    outputFingerprint(warmup.text) === outputFingerprint(reuse.text)
  const cacheReadProven = (reuse.usage.cacheReadTokens ?? 0) > 0
  const totalCostReduced =
    warmup.usage.costUsd === undefined || reuse.usage.costUsd === undefined
      ? null
      : reuse.usage.costUsd < warmup.usage.costUsd

  const reason: PromptCacheProbeResult["reason"] = !outputEquivalent
    ? "quality-regression"
    : !cacheReadProven
      ? "cache-read-unproven"
      : totalCostReduced === null
        ? "cost-unavailable"
        : totalCostReduced
          ? "verified-cheaper"
          : "not-cheaper"

  return {
    routeId: input.adapter.routeId,
    warmup,
    reuse,
    outputEquivalent,
    cacheReadProven,
    totalCostReduced,
    enableRecommended: reason === "verified-cheaper",
    reason,
  }
}

export class FakePromptCacheProbeAdapter implements PromptCacheProbeAdapter {
  readonly routeId: string
  readonly #cache = new Set<string>()
  readonly #qualityRegression: boolean
  readonly #returnCost: boolean

  constructor(input?: {
    routeId?: string
    qualityRegression?: boolean
    returnCost?: boolean
  }) {
    this.routeId = input?.routeId ?? "fake:umapis-claude"
    this.#qualityRegression = input?.qualityRegression ?? false
    this.#returnCost = input?.returnCost ?? true
  }

  async invoke(
    request: PromptCacheProbeRequest
  ): Promise<PromptCacheProbeResponse> {
    const hit = this.#cache.has(request.stablePrefix)
    this.#cache.add(request.stablePrefix)
    const inputTokens = 1_200
    const cacheReadTokens = hit ? 1_000 : 0
    const cacheWriteTokens = hit ? 0 : 1_000
    const uncachedInputTokens =
      inputTokens - cacheReadTokens - cacheWriteTokens
    return {
      text: this.#qualityRegression && hit ? "changed output" : "same output",
      finishReason: "stop",
      usage: {
        inputTokens,
        outputTokens: 100,
        totalTokens: 1_300,
        cacheReadTokens,
        cacheWriteTokens,
        uncachedInputTokens,
        ...(this.#returnCost ? { costUsd: hit ? 0.006 : 0.02 } : {}),
        source: "provider-metadata",
        complete: true,
      },
    }
  }
}
