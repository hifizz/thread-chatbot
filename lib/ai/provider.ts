import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  gateway,
  type LanguageModel,
} from "ai"
import { minimaxChatModel, isMinimaxConfigured } from "@/lib/ai/minimax"
import { arkCodingChatModel, isArkCodingConfigured } from "@/lib/ai/ark"
import {
  getChatModel,
  type ChatModel,
  type OpenRouterModelId,
  type UMAPISModelId,
} from "@/constants/model"
import {
  isOpenRouterConfigured,
  openRouterChatModel,
} from "@/lib/ai/openrouter"
import { isUMAPISConfigured, umapisChatModel } from "@/lib/ai/umapis"
import {
  isPrivateRelayConfigured,
  privateRelayChatModel,
} from "@/lib/ai/private-relay"
import { THREAD_PROVIDER_ROUTING_POLICY_VERSION } from "@/constants/thread-chat"

const CF_ACCOUNT = process.env.CF_AI_GATEWAY_ACCOUNT_ID
const CF_GATEWAY = process.env.CF_AI_GATEWAY_ID
const CF_TOKEN = process.env.CF_AI_GATEWAY_TOKEN

export type PromptCacheStrategy =
  | "implicit"
  | "explicit-breakpoint"
  | "gateway-auto"
  | "unsupported"
  | "probe-required"

export type ModelRouteAdapter =
  | "gateway"
  | "openrouter"
  | "anthropic"
  | "openai-compatible"
  | "private-relay"
  | "ark"
  | "minimax"

export type ModelGateway =
  | "vercel"
  | "cloudflare"
  | "openrouter"
  | "umapis"
  | null

export type ResolvedChatModel = {
  model: LanguageModel
  route: {
    appModelId: string
    adapter: ModelRouteAdapter
    gateway: ModelGateway
    upstreamModelId: string
    routeId: string
    routingPolicyVersion: typeof THREAD_PROVIDER_ROUTING_POLICY_VERSION
  }
  cache: {
    strategy: PromptCacheStrategy
    profileVersion: "route-cache-v1"
    supportsAffinity: boolean
    supportsCacheReadUsage: boolean
    supportsCacheWriteUsage: boolean
    supportedTtls: Array<"provider-default" | "5m" | "1h">
    minimumPrefixTokens?: number
    maxBreakpoints?: number
    retentionClass: "ephemeral-memory" | "extended" | "unknown"
  }
  contextWindowTokens: number
}

function isVercelGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY)
}

export function isGatewayConfigured(): boolean {
  return Boolean(CF_ACCOUNT && CF_GATEWAY)
}

function gatewayCompatBaseURL(): string {
  return `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT}/${CF_GATEWAY}/compat`
}

const PROVIDER_ENV: Record<
  Exclude<
    ChatModel["provider"],
    "minimax" | "ark" | "openrouter" | "umapis" | "private-relay"
  >,
  { key: string | undefined; directBaseURL: string }
> = {
  deepseek: {
    key: process.env.DEEPSEEK_API_KEY,
    directBaseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  },
  openai: {
    key: process.env.OPENAI_API_KEY,
    directBaseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  },
}

export function isModelConfigured(model: ChatModel): boolean {
  if (model.provider === "minimax") return isMinimaxConfigured()
  if (model.provider === "ark") return isArkCodingConfigured()
  if (model.provider === "openrouter") return isOpenRouterConfigured()
  if (model.provider === "private-relay") return isPrivateRelayConfigured()
  if (model.provider === "umapis") {
    return (
      model.umapisCredentialGroup !== undefined &&
      isUMAPISConfigured(model.umapisCredentialGroup)
    )
  }
  if (isVercelGatewayConfigured()) return true
  return Boolean(PROVIDER_ENV[model.provider].key)
}

function routeId(input: {
  adapter: ModelRouteAdapter
  gateway: ModelGateway
  upstreamModelId: string
}): string {
  return [input.adapter, input.gateway ?? "direct", input.upstreamModelId].join(
    ":"
  )
}

function resolved(input: {
  appModelId: string
  model: LanguageModel
  upstreamModelId: string
  adapter: ModelRouteAdapter
  gateway: ModelGateway
  cache: ResolvedChatModel["cache"]
  contextWindowTokens?: number
}): ResolvedChatModel {
  return {
    model: input.model,
    route: {
      appModelId: input.appModelId,
      adapter: input.adapter,
      gateway: input.gateway,
      upstreamModelId: input.upstreamModelId,
      routeId: routeId(input),
      routingPolicyVersion: THREAD_PROVIDER_ROUTING_POLICY_VERSION,
    },
    cache: input.cache,
    contextWindowTokens: input.contextWindowTokens ?? 128_000,
  }
}

const PROBE_CACHE = {
  strategy: "probe-required",
  profileVersion: "route-cache-v1",
  supportsAffinity: false,
  supportsCacheReadUsage: false,
  supportsCacheWriteUsage: false,
  supportedTtls: ["provider-default"] as Array<"provider-default" | "5m" | "1h">,
  retentionClass: "unknown",
} as const satisfies ResolvedChatModel["cache"]

export function resolveChatModelRoute(modelId: string): ResolvedChatModel {
  const registered = getChatModel(modelId)
  if (!registered) throw new Error(`未知模型：${modelId}`)

  if (registered.provider === "minimax") {
    return resolved({
      appModelId: modelId,
      model: minimaxChatModel(registered.upstreamModel),
      upstreamModelId: registered.upstreamModel,
      adapter: "minimax",
      gateway: null,
      cache: PROBE_CACHE,
    })
  }
  if (registered.provider === "ark") {
    return resolved({
      appModelId: modelId,
      model: arkCodingChatModel(registered.upstreamModel),
      upstreamModelId: registered.upstreamModel,
      adapter: "ark",
      gateway: null,
      cache: PROBE_CACHE,
    })
  }
  if (registered.provider === "openrouter") {
    return resolved({
      appModelId: modelId,
      model: openRouterChatModel(
        registered.upstreamModel as OpenRouterModelId
      ),
      upstreamModelId: registered.upstreamModel,
      adapter: "openrouter",
      gateway: "openrouter",
      cache: {
        ...PROBE_CACHE,
        supportsAffinity: true,
        supportsCacheReadUsage: true,
        supportsCacheWriteUsage: true,
        supportedTtls: ["provider-default", "5m"],
      },
    })
  }
  if (registered.provider === "private-relay") {
    return resolved({
      appModelId: modelId,
      model: privateRelayChatModel(registered.upstreamModel),
      upstreamModelId: registered.upstreamModel,
      adapter: "private-relay",
      gateway: null,
      cache: PROBE_CACHE,
    })
  }
  if (registered.provider === "umapis") {
    if (!registered.umapisCredentialGroup) {
      throw new Error(`UMAPIS 模型 ${registered.name} 未声明凭据组`)
    }
    return resolved({
      appModelId: modelId,
      model: umapisChatModel(
        registered.upstreamModel as UMAPISModelId,
        registered.umapisCredentialGroup
      ),
      upstreamModelId: registered.upstreamModel,
      adapter:
        registered.umapisCredentialGroup === "claude"
          ? "anthropic"
          : "openai-compatible",
      gateway: "umapis",
      cache: {
        ...PROBE_CACHE,
        supportsCacheReadUsage:
          registered.umapisCredentialGroup === "claude",
        supportsCacheWriteUsage:
          registered.umapisCredentialGroup === "claude",
        supportedTtls:
          registered.umapisCredentialGroup === "claude"
            ? ["provider-default", "5m"]
            : ["provider-default"],
      },
    })
  }

  if (isVercelGatewayConfigured()) {
    const base = gateway(
      registered.gatewayModel ??
        `${registered.provider}/${registered.upstreamModel}`
    )
    const model =
      registered.reasoningTransport === "think-tags"
        ? wrapLanguageModel({
            model: base,
            middleware: extractReasoningMiddleware({ tagName: "think" }),
          })
        : base
    return resolved({
      appModelId: modelId,
      model,
      upstreamModelId: registered.upstreamModel,
      adapter: "gateway",
      gateway: "vercel",
      cache: {
        strategy: "gateway-auto",
        profileVersion: "route-cache-v1",
        supportsAffinity: false,
        supportsCacheReadUsage: true,
        supportsCacheWriteUsage: true,
        supportedTtls: ["provider-default", "5m"],
        retentionClass: "unknown",
      },
    })
  }

  const env = PROVIDER_ENV[registered.provider]
  if (!env.key) throw new Error(`模型 ${registered.name} 未配置 API Key`)

  const useGateway = isGatewayConfigured()
  const provider = createOpenAICompatible({
    name: `${registered.provider}${useGateway ? "-via-cf" : ""}`,
    baseURL: useGateway ? gatewayCompatBaseURL() : env.directBaseURL,
    apiKey: env.key,
    includeUsage: true,
    headers:
      useGateway && CF_TOKEN
        ? { "cf-aig-authorization": `Bearer ${CF_TOKEN}` }
        : undefined,
  })
  const upstreamId = useGateway
    ? (registered.gatewayModel ?? registered.upstreamModel)
    : registered.upstreamModel
  const base = provider(upstreamId)
  const model =
    registered.reasoningTransport === "think-tags"
      ? wrapLanguageModel({
          model: base,
          middleware: extractReasoningMiddleware({ tagName: "think" }),
        })
      : base
  const directOpenAi = !useGateway && registered.provider === "openai"
  return resolved({
    appModelId: modelId,
    model,
    upstreamModelId: registered.upstreamModel,
    adapter: "openai-compatible",
    gateway: useGateway ? "cloudflare" : null,
    cache: directOpenAi
      ? {
          strategy: "implicit",
          profileVersion: "route-cache-v1",
          supportsAffinity: false,
          supportsCacheReadUsage: true,
          supportsCacheWriteUsage: false,
          supportedTtls: ["provider-default"],
          retentionClass: "ephemeral-memory",
        }
      : PROBE_CACHE,
  })
}

/** Compatibility helper for callers that only need the model object. */
export function resolveChatModel(modelId: string): LanguageModel {
  return resolveChatModelRoute(modelId).model
}
