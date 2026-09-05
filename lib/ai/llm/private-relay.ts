import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { privateRelayModels } from "@/constants/models"
import { createModels } from "@/lib/ai/llm/create-models"

let privateRelayProvider: ReturnType<typeof createOpenAICompatible> | undefined

export function normalizePrivateRelayBaseURL(
  baseURL: string | undefined = process.env.PRIVATE_RELAY_BASE_URL
): string {
  const configured = baseURL?.trim()
  if (!configured) throw new Error("私有模型中继未配置 Base URL")
  const normalized = configured.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

function getPrivateRelayProvider() {
  if (privateRelayProvider) return privateRelayProvider
  const apiKey = process.env.PRIVATE_RELAY_API_KEY?.trim()
  if (!apiKey) throw new Error("私有模型中继未配置 API Key")
  privateRelayProvider = createOpenAICompatible({
    name: "private-relay",
    baseURL: normalizePrivateRelayBaseURL(),
    apiKey,
    includeUsage: true,
  })
  return privateRelayProvider
}

export function isPrivateRelayConfigured(): boolean {
  return Boolean(
    process.env.PRIVATE_RELAY_BASE_URL?.trim() &&
    process.env.PRIVATE_RELAY_API_KEY?.trim()
  )
}

export function privateRelayChatModel(modelId: string): LanguageModel {
  return getPrivateRelayProvider()(modelId)
}

export const privateRelayModelProvider = createModels({
  models: privateRelayModels,
  routeIdentity: (model) => ({
    actualProvider: "private-relay",
    protocol: "openai-compatible",
    upstreamModel: model.id,
  }),
  isConfigured: isPrivateRelayConfigured,
  createProvider: () => (model) => getPrivateRelayProvider()(model.id),
})
