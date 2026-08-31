import { createHmac } from "node:crypto"
import {
  THREAD_PROMPT_CACHE_MODES,
  THREAD_PROMPT_CACHE_PROFILE_VERSION,
  type ThreadPromptCacheMode,
} from "@/constants/thread-chat"
import type { ResolvedChatModel } from "@/lib/ai/provider"

export type PromptProviderJsonValue =
  | string
  | number
  | boolean
  | null
  | PromptProviderJsonValue[]
  | { [key: string]: PromptProviderJsonValue | undefined }

/** Structurally compatible with AI SDK SharedV4ProviderOptions. */
export type PromptProviderOptions = Record<
  string,
  { [key: string]: PromptProviderJsonValue | undefined }
>

/** Route-declared prompt-cache retention option. */
export type PromptCacheTtlClass =
  ResolvedChatModel["cache"]["supportedTtls"][number]

export type PromptCacheControls = {
  mode: ThreadPromptCacheMode
  providerOptions?: PromptProviderOptions
  headers?: Record<string, string>
  affinityHash?: string
  enabled: boolean
  reason: string
  strategy?: ResolvedChatModel["cache"]["strategy"]
  ttlClass?: PromptCacheTtlClass
  markerCount?: number
}

export type PromptCacheBoundaryCandidate = {
  kind: "kernel-end" | "inherited-end" | "branch-history-end"
  tokenEstimate?: number
}

export type SelectedPromptCacheBreakpoint = {
  kind: PromptCacheBoundaryCandidate["kind"]
  tokenEstimate: number
}

export type PromptCacheRouteModes = Record<string, ThreadPromptCacheMode>

const BREAKPOINT_PRIORITY: ReadonlyArray<
  PromptCacheBoundaryCandidate["kind"]
> = ["inherited-end", "branch-history-end", "kernel-end"]

export function resolvePromptCacheMode(
  value: string | undefined = process.env.THREAD_PROMPT_CACHE_MODE
): ThreadPromptCacheMode {
  return THREAD_PROMPT_CACHE_MODES.includes(value as ThreadPromptCacheMode)
    ? (value as ThreadPromptCacheMode)
    : "off"
}

/**
 * Parses server-only per-route rollout overrides. Unknown modes and malformed
 * JSON are ignored instead of changing model behavior.
 */
export function parsePromptCacheRouteModes(
  value: string | undefined = process.env.THREAD_PROMPT_CACHE_ROUTE_MODES
): PromptCacheRouteModes {
  if (!value?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([routeId, mode]) =>
        routeId.trim() &&
        typeof mode === "string" &&
        THREAD_PROMPT_CACHE_MODES.includes(mode as ThreadPromptCacheMode)
          ? [[routeId, mode as ThreadPromptCacheMode]]
          : []
      )
    )
  } catch {
    return {}
  }
}

function normalizedCohortPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 100
  return Math.max(0, Math.min(100, value))
}

function promptCacheCohortBucket(input: {
  salt: string
  userId: string
  projectId: string
  routeId: string
}): number {
  const digest = createHmac("sha256", input.salt)
    .update(
      [
        input.userId,
        input.projectId,
        input.routeId,
        THREAD_PROMPT_CACHE_PROFILE_VERSION,
      ].join("\u001f"),
      "utf8"
    )
    .digest()
  return digest.readUInt32BE(0) % 100
}

/**
 * Route overrides are evaluated first. An enabled route outside the stable
 * cohort is downgraded to observe, never silently turned fully off.
 */
export function resolvePromptCacheModeForRoute(input: {
  routeId: string
  userId: string
  projectId: string
  globalMode?: ThreadPromptCacheMode
  routeModes?: PromptCacheRouteModes
  cohortPercent?: number
  cohortSalt?: string
}): ThreadPromptCacheMode {
  const selected =
    input.routeModes?.[input.routeId] ??
    input.globalMode ??
    resolvePromptCacheMode()
  if (selected !== "enabled") return selected

  const cohortPercent = normalizedCohortPercent(input.cohortPercent)
  if (cohortPercent >= 100) return "enabled"
  if (cohortPercent <= 0) return "observe"
  const salt = input.cohortSalt?.trim()
  if (!salt) return "observe"
  return promptCacheCohortBucket({
    salt,
    userId: input.userId,
    projectId: input.projectId,
    routeId: input.routeId,
  }) < cohortPercent
    ? "enabled"
    : "observe"
}

/**
 * Uses the cheapest short-lived supported option by default. Extended 1h
 * retention requires both an explicit feature flag and retention approval.
 */
export function selectPromptCacheTtl(input: {
  supportedTtls: readonly PromptCacheTtlClass[]
  extendedEnabled?: boolean
  retentionAllowsExtended?: boolean
}): PromptCacheTtlClass {
  const supported = new Set(input.supportedTtls)
  if (
    input.extendedEnabled === true &&
    input.retentionAllowsExtended === true &&
    supported.has("1h")
  ) {
    return "1h"
  }
  if (supported.has("5m")) return "5m"
  if (supported.has("provider-default")) return "provider-default"
  return input.supportedTtls[0] ?? "provider-default"
}

export function promptCacheAffinityKey(input: {
  salt: string
  userId: string
  projectId: string
  upstreamModelId: string
}): string {
  return createHmac("sha256", input.salt)
    .update(
      [
        input.userId,
        input.projectId,
        input.upstreamModelId,
        THREAD_PROMPT_CACHE_PROFILE_VERSION,
      ].join("\u001f"),
      "utf8"
    )
    .digest("hex")
}

/** Merge provider namespaces without mutating either input. */
export function mergePromptProviderOptions(
  left: PromptProviderOptions | undefined,
  right: PromptProviderOptions | undefined
): PromptProviderOptions | undefined {
  if (!left && !right) return undefined
  const merged: PromptProviderOptions = {}
  for (const source of [left, right]) {
    if (!source) continue
    for (const [provider, options] of Object.entries(source)) {
      merged[provider] = {
        ...(merged[provider] ?? {}),
        ...options,
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Explicit-cache routes have limited marker counts. Selection is deterministic:
 * sibling reuse first, continuation reuse second, kernel reuse last.
 */
export function selectPromptCacheBreakpoints(input: {
  candidates: readonly PromptCacheBoundaryCandidate[]
  minimumPrefixTokens: number
  maximumBreakpoints: number
}): SelectedPromptCacheBreakpoint[] {
  if (
    !Number.isFinite(input.minimumPrefixTokens) ||
    input.minimumPrefixTokens < 0 ||
    !Number.isInteger(input.maximumBreakpoints) ||
    input.maximumBreakpoints < 0
  ) {
    throw new Error("INVALID_PROMPT_CACHE_BREAKPOINT_POLICY")
  }
  const byKind = new Map(input.candidates.map((candidate) => [candidate.kind, candidate]))
  return BREAKPOINT_PRIORITY.flatMap((kind) => {
    const candidate = byKind.get(kind)
    const tokenEstimate = candidate?.tokenEstimate
    return typeof tokenEstimate === "number" &&
      Number.isFinite(tokenEstimate) &&
      tokenEstimate >= input.minimumPrefixTokens
      ? [{ kind, tokenEstimate }]
      : []
  }).slice(0, input.maximumBreakpoints)
}

export function buildPromptCacheControls(input: {
  resolved: ResolvedChatModel
  userId: string
  projectId: string
  mode?: ThreadPromptCacheMode
  affinitySalt?: string
}): PromptCacheControls {
  const mode = input.mode ?? resolvePromptCacheMode()
  if (mode !== "enabled") {
    return {
      mode,
      enabled: false,
      reason: mode === "observe" ? "observe-only" : "disabled",
      strategy: input.resolved.cache.strategy,
    }
  }
  if (
    input.resolved.cache.strategy === "probe-required" ||
    input.resolved.cache.strategy === "unsupported"
  ) {
    return {
      mode,
      enabled: false,
      reason: input.resolved.cache.strategy,
      strategy: input.resolved.cache.strategy,
    }
  }

  const providerOptions: PromptProviderOptions = {}
  if (input.resolved.cache.strategy === "gateway-auto") {
    providerOptions.gateway = { caching: "auto" }
  }

  const headers: Record<string, string> = {}
  let affinityHash: string | undefined
  if (input.resolved.cache.supportsAffinity && input.affinitySalt) {
    affinityHash = promptCacheAffinityKey({
      salt: input.affinitySalt,
      userId: input.userId,
      projectId: input.projectId,
      upstreamModelId: input.resolved.route.upstreamModelId,
    })
    headers["x-session-id"] = affinityHash
  }

  return {
    mode,
    enabled: true,
    reason: input.resolved.cache.strategy,
    strategy: input.resolved.cache.strategy,
    ...(Object.keys(providerOptions).length ? { providerOptions } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(affinityHash ? { affinityHash } : {}),
  }
}

export function withoutPromptCacheControls<T extends {
  providerOptions?: PromptProviderOptions
  headers?: Record<string, string>
}>(value: T): Omit<T, "providerOptions" | "headers"> {
  const entries = Object.entries(value).filter(
    ([key]) => key !== "providerOptions" && key !== "headers"
  )
  return Object.fromEntries(entries) as Omit<T, "providerOptions" | "headers">
}

/**
 * Contains cache-option rejection without changing ordinary model behavior.
 * The caller decides which provider errors are cache-control rejections; all
 * other failures are rethrown unchanged.
 */
export async function executeWithPromptCacheFallback<TOptions, TResult>(input: {
  primary: TOptions
  fallback: TOptions
  execute: (options: TOptions) => TResult | Promise<TResult>
  isCacheControlRejection: (error: unknown) => boolean
  onFallback?: (error: unknown) => void
}): Promise<{ result: TResult; usedFallback: boolean }> {
  try {
    return { result: await input.execute(input.primary), usedFallback: false }
  } catch (error) {
    if (!input.isCacheControlRejection(error)) throw error
    input.onFallback?.(error)
    return {
      result: await input.execute(input.fallback),
      usedFallback: true,
    }
  }
}

export function looksLikePromptCacheControlRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:cache[_ -]?(?:control|key|ttl)|provideroptions|x-session-id).*(?:unsupported|invalid|unknown|reject|400)/i.test(
    message
  )
}

export const PROMPT_CACHE_ROUTE_PROBES = [
  {
    route: "vercel-gateway",
    defaultStrategy: "gateway-auto",
    status: "verify-types-and-usage",
  },
  {
    route: "openrouter",
    defaultStrategy: "probe-required",
    status: "verify-affinity-marker-usage-cost",
  },
  {
    route: "umapis-claude",
    defaultStrategy: "probe-required",
    status: "first-fake-and-live-probe-target",
  },
  {
    route: "private-relay",
    defaultStrategy: "probe-required",
    status: "must-not-infer-from-openai-compatible",
  },
  {
    route: "ark-minimax-cloudflare-compatible",
    defaultStrategy: "probe-required",
    status: "verify-before-enable",
  },
] as const
