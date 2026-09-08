import { tokenRouterModels } from "@/constants/models/token-router"
import { arkModels } from "@/constants/models/ark"
import { deepseekModels } from "@/constants/models/deepseek"
import { icelandModels } from "@/constants/models/iceland"
import { minimaxModels } from "@/constants/models/minimax"
import { openaiModels } from "@/constants/models/openai"
import { openrouterModels } from "@/constants/models/openrouter"
import { privateRelayModels } from "@/constants/models/private-relay"
import {
  expandProviderModels,
  type ClientModelOption,
  type ProviderModelsDefinition,
  type PublicModel,
} from "@/constants/models/types"

const MODEL_PROVIDER_REGISTRY = [
  minimaxModels,
  deepseekModels,
  openaiModels,
  tokenRouterModels,
  openrouterModels,
  arkModels,
] as const

export type ModelProviderId = (typeof MODEL_PROVIDER_REGISTRY)[number]["id"]
export type ModelId = string

export const MODEL_PROVIDERS: readonly ProviderModelsDefinition[] =
  MODEL_PROVIDER_REGISTRY

export const MODELS: readonly PublicModel[] = MODEL_PROVIDERS.flatMap(
  expandProviderModels
)

/** 其他 provider 暂留注册表供历史记录使用，本期只收敛选择入口与默认模型。 */
export const AVAILABLE_MODELS: readonly PublicModel[] = MODELS.filter(
  (model) => model.providerId === tokenRouterModels.id
)

export const DEFAULT_MODEL_ID: ModelId = "private-relay-gpt-5.6-luna"
export const DEFAULT_THREAD_CHAT_MODEL_ID: ModelId = DEFAULT_MODEL_ID

export const THREAD_CHAT_MODEL_OPTIONS: readonly ClientModelOption[] = AVAILABLE_MODELS
  .filter((model) => model.surfaces.includes("thread"))
  .map((model) => ({
    id: model.id,
    name: model.name,
    ...(model.contextLabel ? { contextLabel: model.contextLabel } : {}),
    ...(model.description ? { description: model.description } : {}),
    groupId: model.providerId,
    groupName: model.providerName,
    capabilities: model.capabilities,
  }))

export {
  tokenRouterModels,
  arkModels,
  deepseekModels,
  icelandModels,
  minimaxModels,
  openaiModels,
  openrouterModels,
  privateRelayModels,
}
export { publicModelId } from "@/constants/models/types"
export type {
  ClientModelOption,
  ModelCapabilities,
  ModelDefinition,
  ModelSurface,
  ProviderModelsDefinition,
  PublicModel,
} from "@/constants/models/types"
