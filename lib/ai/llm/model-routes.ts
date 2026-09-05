import type { LanguageModel } from "ai"
import type { OpenRouterModelId } from "@/constants/model"
import {
  CHAT_MODELS,
  getChatModel,
  type ChatModel,
  type ChatModelId,
} from "@/constants/model"
import { arkCodingChatModel, isArkCodingConfigured } from "@/lib/ai/llm/ark"
import {
  isCloudflareGatewayConfigured,
  isVercelGatewayConfigured,
  cloudflareGatewayChatModel,
  vercelGatewayChatModel,
} from "@/lib/ai/llm/gateway"
import {
  icelandRelayChatModel,
  isIcelandRelayConfigured,
} from "@/lib/ai/llm/iceland-relay"
import {
  isMinimaxConfigured,
  minimaxChatModel,
} from "@/lib/ai/llm/minimax"
import {
  isOpenRouterConfigured,
  openRouterChatModel,
} from "@/lib/ai/llm/openrouter"
import {
  isPrivateRelayConfigured,
  privateRelayChatModel,
} from "@/lib/ai/llm/private-relay"

/**
 * 产品模型 ID 对应的一条服务端私有路由。
 * 业务层只接收 createModel 返回的 LanguageModel，不接触路由细节。
 */
export type ModelRoute = {
  provider: ChatModel["provider"]
  createModel: () => LanguageModel
}

/**
 * 服务端人工审核的模型列表。
 *
 * 模型 ID 来自产品注册表；真实上游 ID 仍只由服务端注册表和 provider 创建函数使用。
 * 这里集中生成路由表，不向客户端导出。
 */
const MODEL_ROUTES: Readonly<Record<ChatModelId, ModelRoute>> =
  Object.fromEntries(
    CHAT_MODELS.map((model) => [model.id, createModelRoute(model)])
  ) as Record<ChatModelId, ModelRoute>

function createModelRoute(model: ChatModel): ModelRoute {
  switch (model.provider) {
    case "minimax":
      return {
        provider: model.provider,
        createModel: () => minimaxChatModel(model.upstreamModel),
      }
    case "ark":
      return {
        provider: model.provider,
        createModel: () => arkCodingChatModel(model.upstreamModel),
      }
    case "openrouter":
      return {
        provider: model.provider,
        createModel: () =>
          openRouterChatModel(model.upstreamModel as OpenRouterModelId),
      }
    case "private-relay":
      return {
        provider: model.provider,
        createModel: () => privateRelayChatModel(model.upstreamModel),
      }
    case "iceland-relay":
      return {
        provider: model.provider,
        createModel: () => {
          if (!model.icelandProtocol) {
            throw new Error(`冰岛模型 ${model.name} 未声明调用协议`)
          }
          return icelandRelayChatModel(model.upstreamModel, model.icelandProtocol)
        },
      }
    case "deepseek":
      return {
        provider: model.provider,
        // 该产品模型明确绑定 Cloudflare，不再根据全局配置隐式回退。
        createModel: () =>
          cloudflareGatewayChatModel({
            providerName: model.provider,
            upstreamModel: model.upstreamModel,
            upstreamApiKey: requireServerEnv("DEEPSEEK_API_KEY"),
            gatewayModel: model.gatewayModel,
          }),
      }
    case "openai":
      return {
        provider: model.provider,
        // 该产品模型明确绑定 Vercel AI Gateway。
        createModel: () =>
          vercelGatewayChatModel(
            model.gatewayModel ?? `${model.provider}/${model.upstreamModel}`
          ),
      }
  }
}

/** 读取服务端配置，错误信息不包含配置值。 */
function requireServerEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少服务端环境变量：${name}`)
  return value
}

/** 判断产品模型对应的私有路由是否具备最小调用配置。 */
export function isModelConfigured(model: ChatModel): boolean {
  switch (model.provider) {
    case "minimax":
      return isMinimaxConfigured()
    case "ark":
      return isArkCodingConfigured()
    case "openrouter":
      return isOpenRouterConfigured()
    case "private-relay":
      return isPrivateRelayConfigured()
    case "iceland-relay":
      return model.icelandProtocol !== undefined && isIcelandRelayConfigured()
    case "deepseek":
      return isCloudflareGatewayConfigured() &&
        Boolean(process.env.DEEPSEEK_API_KEY?.trim())
    case "openai":
      return isVercelGatewayConfigured()
  }
}

/** 通过公开产品模型 ID 解析服务端 LanguageModel。 */
export function resolveChatModel(modelId: string): LanguageModel {
  const route = MODEL_ROUTES[modelId as ChatModelId]
  if (!route || !getChatModel(modelId)) throw new Error(`未知模型：${modelId}`)
  return route.createModel()
}

/** 计费和观测只需要服务端知道该模型的原始 provider。 */
export function getModelRouteProvider(modelId: string): ChatModel["provider"] {
  const route = MODEL_ROUTES[modelId as ChatModelId]
  if (!route) throw new Error(`未知模型：${modelId}`)
  return route.provider
}
