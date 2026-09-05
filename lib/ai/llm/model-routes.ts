import type { LanguageModel } from "ai"
import type { ChatModel, ChatModelProvider } from "@/constants/model"
import type { ModelRoute } from "@/lib/ai/llm/create-models"
import {
  getModelRouteProvider as getProvider,
  isModelConfigured as configured,
  resolveChatModel as resolve,
} from "@/lib/ai/llm/providers"

export type { ModelRoute }
export { resolveChatModelWithRoute } from "@/lib/ai/llm/providers"

export function isModelConfigured(model: Pick<ChatModel, "id">): boolean {
  return configured(model.id)
}

export function resolveChatModel(modelId: string): LanguageModel {
  return resolve(modelId)
}

export function getModelRouteProvider(modelId: string): ChatModelProvider {
  return getProvider(modelId)
}
