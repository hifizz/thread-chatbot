import type { GenerationSettingsCapability } from "@/constants/generation-settings"

export type ModelSurface = "linear" | "thread"

export type ModelCapabilities = {
  reasoning?: boolean
  attachments?: boolean
  imageInput?: boolean
  generationSettings?: GenerationSettingsCapability
}

export type ModelDefinition = {
  id: string
  name?: string
  description?: string
  surfaces?: readonly ModelSurface[]
  capabilities?: ModelCapabilities
  unbilledPreview?: true
}

export type ProviderModelDefaults = Omit<ModelDefinition, "id" | "name">

export type ProviderModelsDefinition = {
  id: string
  name: string
  defaults: ProviderModelDefaults & { surfaces: readonly ModelSurface[] }
  models: readonly ModelDefinition[]
  toPublicModelId?: (providerModelId: string) => string
}

export type PublicModel = {
  id: string
  name: string
  description?: string
  providerId: string
  providerName: string
  surfaces: readonly ModelSurface[]
  capabilities: ModelCapabilities
  unbilledPreview?: true
}

export type ClientModelOption = {
  id: string
  name: string
  description?: string
  groupId: string
  groupName: string
  capabilities: ModelCapabilities
}

export function defineProviderModels<const T extends ProviderModelsDefinition>(
  definition: T
): T {
  return definition
}

export function publicModelId(
  provider: ProviderModelsDefinition,
  model: ModelDefinition
): string {
  return provider.toPublicModelId?.(model.id) ?? model.id
}

export function expandProviderModels(
  provider: ProviderModelsDefinition
): readonly PublicModel[] {
  return provider.models.map((model) => ({
    id: publicModelId(provider, model),
    name: model.name ?? model.id,
    ...(model.description ?? provider.defaults.description
      ? { description: model.description ?? provider.defaults.description }
      : {}),
    providerId: provider.id,
    providerName: provider.name,
    surfaces: model.surfaces ?? provider.defaults.surfaces,
    capabilities: {
      ...provider.defaults.capabilities,
      ...model.capabilities,
    },
    ...(model.unbilledPreview ?? provider.defaults.unbilledPreview
      ? { unbilledPreview: true as const }
      : {}),
  }))
}
