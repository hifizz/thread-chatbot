import {
  DEFAULT_MODEL_ID,
  DEFAULT_THREAD_CHAT_MODEL_ID,
  MODELS,
  type ModelCapabilities,
  type ModelId,
  type ModelProviderId,
  type ModelSurface,
} from "@/constants/models"

export const THREAD_TITLE_MODEL_ID = "gpt-5.6-luna"
export const THREAD_TITLE_MAX_OUTPUT_TOKENS = 36

export type ChatModelProvider = ModelProviderId
export type ChatModelSurface = ModelSurface
export type ChatModelId = ModelId

export type ChatModel = {
  id: ChatModelId
  name: string
  description?: string
  provider: ChatModelProvider
  capabilities: ModelCapabilities
  supportsImageInput: boolean
  unbilledPreview?: true
  surfaces: readonly ChatModelSurface[]
}

export const CHAT_MODELS: readonly ChatModel[] = MODELS.map((model) => ({
  id: model.id as ChatModelId,
  name: model.name,
  ...(model.description ? { description: model.description } : {}),
  provider: model.providerId as ChatModelProvider,
  capabilities: model.capabilities,
  supportsImageInput: model.capabilities.imageInput === true,
  ...(model.unbilledPreview ? { unbilledPreview: true as const } : {}),
  surfaces: model.surfaces,
}))

export { DEFAULT_MODEL_ID, DEFAULT_THREAD_CHAT_MODEL_ID }

export const THREAD_CHAT_MODELS: readonly ChatModel[] = CHAT_MODELS.filter(
  (model) => model.surfaces.includes("thread")
)

export const MAX_OUTPUT_TOKENS = 16_000

export function getChatModel(id: string | undefined): ChatModel | undefined {
  return CHAT_MODELS.find((model) => model.id === id)
}

export function supportsModelImageInput(
  modelId: string | undefined
): boolean {
  return getChatModel(modelId)?.supportsImageInput === true
}

export function getModelGenerationSettingsCapability(
  modelId: string | undefined
) {
  return getChatModel(modelId)?.capabilities.generationSettings
}

export function isUnbilledPreviewModel(model: ChatModel): boolean {
  return model.unbilledPreview === true
}

export function isChatModelId(id: unknown): id is ChatModelId {
  return typeof id === "string" && getChatModel(id) !== undefined
}

export function isThreadChatModelId(id: unknown): id is ChatModelId {
  return (
    typeof id === "string" &&
    THREAD_CHAT_MODELS.some((model) => model.id === id)
  )
}

export function isLinearChatModelId(id: unknown): id is ChatModelId {
  return (
    typeof id === "string" &&
    getChatModel(id)?.surfaces.includes("linear") === true
  )
}

export function resolveModelId(id: string | undefined): ChatModelId {
  return isChatModelId(id) ? id : DEFAULT_MODEL_ID
}

export function resolveThreadChatModelId(
  id: string | undefined
): ChatModelId {
  return isThreadChatModelId(id) ? id : DEFAULT_THREAD_CHAT_MODEL_ID
}
