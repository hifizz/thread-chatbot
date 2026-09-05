import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { ARK_CODING_BASE_URL } from "@/constants/ark"
import { arkModels } from "@/constants/models"
import { createModels } from "@/lib/ai/llm/create-models"

let arkProvider: ReturnType<typeof createOpenAICompatible> | undefined

function getArkProvider() {
  if (arkProvider) return arkProvider
  const apiKey = process.env.ARK_CODING_API_KEY
  if (!apiKey) throw new Error("火山方舟 Coding Plan 未配置 API Key")
  arkProvider = createOpenAICompatible({
    name: "ark-coding",
    baseURL: process.env.ARK_CODING_BASE_URL ?? ARK_CODING_BASE_URL,
    apiKey,
    includeUsage: true,
  })
  return arkProvider
}

export function isArkCodingConfigured(): boolean {
  return Boolean(process.env.ARK_CODING_API_KEY)
}

export function arkCodingChatModel(modelId: string): LanguageModel {
  return getArkProvider()(modelId)
}

export const arkModelProvider = createModels({
  models: arkModels,
  isConfigured: isArkCodingConfigured,
  createProvider: () => (model) => getArkProvider()(model.id),
})
