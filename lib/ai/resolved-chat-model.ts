import { createHmac } from "node:crypto"
import type { LanguageModel, ProviderOptions } from "ai"
import { getChatModel } from "@/constants/model"
import {
  PROMPT_CACHE_PROFILE_VERSION,
  PROVIDER_ROUTING_POLICY_VERSION,
  type PromptCacheMode,
} from "@/constants/prompt-cache"
import { resolveChatModel } from "@/lib/ai/provider"

export type PromptCacheStrategy =
  | "implicit"
  | "explicit-breakpoint"
  | "gateway-auto"
  | "unsupported"
  | "probe-required"

export interface ResolvedChatModel {
  model: LanguageModel
  route: {
    appModelId: string
    adapter:
      | "gateway"
      | "openrouter"
      | "anthropic"
      | "openai-compatible"
      | "private-relay"
      | "ark"
      | "minimax"
    gateway:
      | "vercel"
      | "cloudflare"
      | "openrouter"
      | "umapis"
      | null
    upstreamModelId: string
    routeId: string
    routingPolicyVersion: typeof PROVIDER_ROUTING_POLICY_VERSION
  }
  cache: {
    strategy: PromptCacheStrategy
    profileVersion: typeof PROMPT_CACHE_PROFILE_VERSION
    supportsAffinity: boolean
    supportsCacheReadUsage: boolean
    supportsCacheWriteUsage: boolean
    supportedTtls: Array<"provider-default" | "5m" | "1h">
    minimumPrefixTokens?: number
    maxBreakpoints?: number
    retentionClass: "ephemeral-memory" | "extended" | "unknown"
  }
}

function routeIdentity(modelId: string): Omit<ResolvedChatModel["route"], "appModelId" | "upstreamModelId" | "routingPolicyVersion"> & {
  cache: ResolvedChatModel["cache"]
} {
  const registered = getChatModel(modelId)
  if (!registered) throw new Error(`未知模型：${modelId}`)
  const common = {
    profileVersion: PROMPT_CACHE_PROFILE_VERSION,
    supportedTtls: ["provider-default"] as Array<
      "provider-default" | "5m" | "1h"
    >,
  }

  if (registered.provider === "openrouter") {
    return {
      adapter: "openrouter",
      gateway: "openrouter",
      routeId: `openrouter:${registered.upstreamModel}`,
      cache: {
        ...common,
        strategy: "implicit",
        supportsAffinity: true,
        supportsCacheReadUsage: true,
        supportsCacheWriteUsage: true,
        minimumPrefixTokens: 1_024,
        retentionClass: "ephemeral-memory",
      },
    }
  }
  if (registered.provider === "umapis") {
    return {
      adapter: "anthropic",
      gateway: "umapis",
      routeId: `umapis:${registered.upstreamModel}`,
      cache: {
        ...common,
        strategy: "probe-required",
        supportsAffinity: false,
        supportsCacheReadUsage: false,
        supportsCacheWriteUsage: false,
        retentionClass: "unknown",
      },
    }
  }
  if (registered.provider === "private-relay") {
    return {
      adapter: "private-relay",
      gateway: null,
      routeId: `private-relay:${registered.upstreamModel}`,
      cache: {
        ...common,
        strategy: "probe-required",
        supportsAffinity: false,
        supportsCacheReadUsage: false,
        supportsCacheWriteUsage: false,
        retentionClass: "unknown",
      },
    }
  }
  if (registered.provider === "ark") {
    return {
      adapter: "ark",
      gateway: null,
      routeId: `ark:${registered.upstreamModel}`,
      cache: {
        ...common,
        strategy: "probe-required",
        supportsAffinity: false,
        supportsCacheReadUsage: false,
        supportsCacheWriteUsage: false,
        retentionClass: "unknown",
      },
    }
  }
  if (registered.provider === "minimax") {
    return {
      adapter: "minimax",
      gateway: null,
      routeId: `minimax:${registered.upstreamModel}`,
      cache: {
        ...common,
        strategy: "probe-required",
        supportsAffinity: false,
        supportsCacheReadUsage: false,
        supportsCacheWriteUsage: false,
        retentionClass: "unknown",
      },
    }
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    return {
      adapter: "gateway",
      gateway: "vercel",
      routeId: `vercel:${registered.gatewayModel ?? `${registered.provider}/${registered.upstreamModel}`}`,
      cache: {
        ...common,
        strategy: "gateway-auto",
        supportsAffinity: false,
        supportsCacheReadUsage: true,
        supportsCacheWriteUsage: true,
        minimumPrefixTokens: 1_024,
        retentionClass: "ephemeral-memory",
      },
    }
  }
  if (
    process.env.CF_AI_GATEWAY_ACCOUNT_ID &&
    process.env.CF_AI_GATEWAY_ID
  ) {
    return {
      adapter: "openai-compatible",
      gateway: "cloudflare",
      routeId: `cloudflare:${registered.gatewayModel ?? registered.upstreamModel}`,
      cache: {
        ...common,
        strategy: "probe-required",
        supportsAffinity: false,
        supportsCacheReadUsage: false,
        supportsCacheWriteUsage: false,
        retentionClass: "unknown",
      },
    }
  }
  return {
    adapter: "openai-compatible",
    gateway: null,
    routeId: `${registered.provider}:${registered.upstreamModel}`,
    cache: {
      ...common,
      strategy:
        registered.provider === "openai" ? "implicit" : "probe-required",
      supportsAffinity: false,
      supportsCacheReadUsage: registered.provider === "openai",
      supportsCacheWriteUsage: false,
      minimumPrefixTokens:
        registered.provider === "openai" ? 1_024 : undefined,
      retentionClass:
        registered.provider === "openai" ? "ephemeral-memory" : "unknown",
    },
  }
}

export function resolveChatModelRoute(modelId: string): ResolvedChatModel {
  const registered = getChatModel(modelId)
  if (!registered) throw new Error(`未知模型：${modelId}`)
  const identity = routeIdentity(modelId)
  return {
    model: resolveChatModel(modelId),
    route: {
      appModelId: modelId,
      adapter: identity.adapter,
      gateway: identity.gateway,
      upstreamModelId: registered.upstreamModel,
      routeId: identity.routeId,
      routingPolicyVersion: PROVIDER_ROUTING_POLICY_VERSION,
    },
    cache: identity.cache,
  }
}

export function promptCacheAffinityKey(input: {
  userId: string
  projectId: string
  upstreamModelId: string
  salt?: string
}): string | null {
  const salt = input.salt ?? process.env.PROMPT_CACHE_AFFINITY_SALT
  if (!salt?.trim()) return null
  return createHmac("sha256", salt)
    .update(
      [
        input.userId,
        input.projectId,
        input.upstreamModelId,
        PROMPT_CACHE_PROFILE_VERSION,
      ].join(":"),
      "utf8"
    )
    .digest("hex")
}

export function buildRouteCacheControls(input: {
  resolved: ResolvedChatModel
  cacheMode: PromptCacheMode
  userId: string
  projectId: string
}): {
  cacheSupported: boolean
  providerOptions?: ProviderOptions
  headers?: Record<string, string>
} {
  const strategy = input.resolved.cache.strategy
  const cacheSupported =
    strategy !== "unsupported" && strategy !== "probe-required"
  if (input.cacheMode !== "enabled" || !cacheSupported) {
    return { cacheSupported }
  }
  if (strategy === "gateway-auto") {
    return {
      cacheSupported,
      providerOptions: {
        gateway: { caching: "auto" },
      } as ProviderOptions,
    }
  }
  if (input.resolved.cache.supportsAffinity) {
    const affinity = promptCacheAffinityKey({
      userId: input.userId,
      projectId: input.projectId,
      upstreamModelId: input.resolved.route.upstreamModelId,
    })
    return {
      cacheSupported,
      ...(affinity ? { headers: { "x-session-id": affinity } } : {}),
    }
  }
  return { cacheSupported }
}
