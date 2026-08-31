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

export type PromptCacheControls = {
  mode: ThreadPromptCacheMode
  providerOptions?: PromptProviderOptions
  headers?: Record<string, string>
  affinityHash?: string
  enabled: boolean
  reason: string
}

export type PromptCacheBoundaryCandidate = {
  kind: "kernel-end" | "inherited-end" | "branch-history-end"
  tokenEstimate?: number
}

export type SelectedPromptCacheBreakpoint = {
  kind: PromptCacheBoundaryCandidate["kind"]
  tokenEstimate: number
}

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
    ...(Object.keys(providerOptions).length ? { providerOptions } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(affinityHash ? { affinityHash } : {}),
  }
}

export function withoutPromptCacheControls<T extends {
  providerOptions?: PromptProviderOptions
  headers?: Record<string, string>
}>(value: T): Omit<T, "providerOptions" | "headers"> {
  const { providerOptions: _providerOptions, headers: _headers, ...fallback } = value
  return fallback
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
