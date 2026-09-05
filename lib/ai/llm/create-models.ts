import type { LanguageModel } from "ai"
import {
  publicModelId,
  type ModelDefinition,
  type ProviderModelsDefinition,
} from "@/constants/models"

export type ModelRoute = {
  provider: string
  isConfigured: () => boolean
  createModel: () => LanguageModel
}

type ModelFactory = (model: ModelDefinition) => LanguageModel

type CreateModelsInput<TModels extends ProviderModelsDefinition> = {
  models: TModels
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
        isConfigured: input.isConfigured,
        createModel: () => getProvider()(model),
      } satisfies ModelRoute,
    })),
  }
}
