import { createHmac } from "node:crypto"
import type { ProviderOptions } from "ai"
import type {
  PromptCacheRolloutMode,
} from "@/constants/thread-chat-prompt-cache"
import type { ResolvedChatModelRoute } from "@/lib/thread-chat/prompt-cache/types"

export interface PromptCacheProviderControls {
  providerOptions?: ProviderOptions
  headers?: Record<string, string>
  applied:
    | "none"
    | "gateway-auto"
    | "implicit"
    | "explicit-breakpoint"
  reason:
    | "rollout-off"
    | "observe-only"
    | "enabled"
    | "probe-required"
    | "unsupported"
}

export function promptCacheAffinityKey(input: {
  salt: string
  userId: string
  projectId: string
  upstreamModelId: string
  cacheProfileVersion: string
}): string {
  return createHmac("sha256", input.salt)
    .update(
      JSON.stringify([
        input.userId,
        input.projectId,
        input.upstreamModelId,
        input.cacheProfileVersion,
      ])
    )
    .digest("hex")
}

export function buildPromptCacheProviderControls(input: {
  resolved: ResolvedChatModelRoute
  rolloutMode: PromptCacheRolloutMode
  userId: string
  projectId: string
  affinitySalt?: string
}): PromptCacheProviderControls {
  if (input.rolloutMode === "off") {
    return { applied: "none", reason: "rollout-off" }
  }
  if (input.rolloutMode === "observe") {
    return { applied: "none", reason: "observe-only" }
  }

  const strategy = input.resolved.cache.strategy
  if (strategy === "probe-required") {
    return { applied: "none", reason: "probe-required" }
  }
  if (strategy === "unsupported") {
    return { applied: "none", reason: "unsupported" }
  }

  const headers: Record<string, string> = {}
  if (
    input.resolved.cache.supportsAffinity &&
    input.resolved.route.gateway === "openrouter" &&
    input.affinitySalt
  ) {
    headers["x-session-id"] = promptCacheAffinityKey({
      salt: input.affinitySalt,
      userId: input.userId,
      projectId: input.projectId,
      upstreamModelId: input.resolved.route.upstreamModelId,
      cacheProfileVersion: input.resolved.cache.profileVersion,
    })
  }

  if (strategy === "gateway-auto") {
    return {
      providerOptions: {
        gateway: { caching: "auto" },
      } as ProviderOptions,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      applied: "gateway-auto",
      reason: "enabled",
    }
  }

  return {
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    applied: strategy,
    reason: "enabled",
  }
}
