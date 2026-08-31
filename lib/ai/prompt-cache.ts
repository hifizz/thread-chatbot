import { createHmac } from "node:crypto"
import {
  THREAD_PROMPT_CACHE_MODES,
  THREAD_PROMPT_CACHE_PROFILE_VERSION,
  type ThreadPromptCacheMode,
} from "@/constants/thread-chat"
import type { ResolvedChatModel } from "@/lib/ai/provider"

export type PromptCacheControls = {
  mode: ThreadPromptCacheMode
  providerOptions?: Record<string, Record<string, unknown>>
  headers?: Record<string, string>
  affinityHash?: string
  enabled: boolean
  reason: string
}

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

  const providerOptions: Record<string, Record<string, unknown>> = {}
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
