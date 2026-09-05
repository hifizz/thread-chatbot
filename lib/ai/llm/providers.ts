import type { LanguageModel } from "ai"
import type { ModelProviderId } from "@/constants/models"
import type { ModelRoute } from "@/lib/ai/llm/create-models"
import { arkModelProvider } from "@/lib/ai/llm/ark"
import { deepseekModelProvider } from "@/lib/ai/llm/deepseek"
import { icelandModelProvider } from "@/lib/ai/llm/iceland"
import { minimaxModelProvider } from "@/lib/ai/llm/minimax"
import { openaiModelProvider } from "@/lib/ai/llm/openai"
import { openrouterModelProvider } from "@/lib/ai/llm/openrouter"
import { privateRelayModelProvider } from "@/lib/ai/llm/private-relay"

export const PROVIDERS = {
  minimax: minimaxModelProvider,
  deepseek: deepseekModelProvider,
  openai: openaiModelProvider,
  ark: arkModelProvider,
  openrouter: openrouterModelProvider,
  "private-relay": privateRelayModelProvider,
  "iceland-relay": icelandModelProvider,
} satisfies Record<ModelProviderId, { id: ModelProviderId }>

const routes = Object.values(PROVIDERS).flatMap((provider) => provider.routes)
const MODEL_ROUTES = new Map<string, ModelRoute>(
  routes.map(({ id, route }) => [id, route])
)

export function isModelConfigured(modelId: string): boolean {
  return MODEL_ROUTES.get(modelId)?.isConfigured() === true
}

export function resolveChatModel(modelId: string): LanguageModel {
  return resolveChatModelWithRoute(modelId).model
}

export function resolveChatModelWithRoute(modelId: string) {
  const route = MODEL_ROUTES.get(modelId)
  if (!route) throw new Error(`未知模型：${modelId}`)
  return { model: route.createModel(), route: route.identity }
}

export function getModelRouteProvider(modelId: string): ModelProviderId {
  const route = MODEL_ROUTES.get(modelId)
  if (!route) throw new Error(`未知模型：${modelId}`)
  return route.provider as ModelProviderId
}
