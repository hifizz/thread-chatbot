import type { LanguageModel } from "ai"
import {
  publicModelId,
  type ModelDefinition,
  type ProviderModelsDefinition,
} from "@/constants/models"

/** 服务端实际调用身份，独立于客户端展示名称。 */
export type ModelRouteIdentity = {
  actualProvider: string
  protocol:
    "anthropic" | "openai-compatible" | "openrouter" | "vercel-ai-gateway"
  upstreamModel: string
  credentialGroup?: string
}

export type ModelRoute = {
  provider: string
  identity: ModelRouteIdentity
  isConfigured: () => boolean
  createModel: () => LanguageModel
}

type ModelFactory = (model: ModelDefinition) => LanguageModel

type CreateModelsInput<TModels extends ProviderModelsDefinition> = {
  models: TModels
  routeIdentity: (model: ModelDefinition) => ModelRouteIdentity
  isConfigured: () => boolean
  createProvider: () => ModelFactory
}

export function createModels<const TModels extends ProviderModelsDefinition>(
  input: CreateModelsInput<TModels>
) {
  let provider: ModelFactory | undefined
  const getProvider = () => (provider ??= input.createProvider())

  return {
    id: input.models.id as TModels["id"],
    routes: input.models.models.map((model) => ({
      id: publicModelId(input.models, model),
      route: {
        provider: input.models.id,
        identity: input.routeIdentity(model),
        isConfigured: input.isConfigured,
        createModel: () => getProvider()(model),
      } satisfies ModelRoute,
    })),
  }
}
