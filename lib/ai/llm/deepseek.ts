import { deepseekModels } from "@/constants/models"
import { createModels } from "@/lib/ai/llm/create-models"
import {
  cloudflareGatewayChatModel,
  isCloudflareGatewayConfigured,
} from "@/lib/ai/llm/gateway"

function apiKey(): string {
  const value = process.env.DEEPSEEK_API_KEY?.trim()
  if (!value) throw new Error("DeepSeek 未配置 API Key")
  return value
}

function isDeepSeekConfigured(): boolean {
  return (
    isCloudflareGatewayConfigured() &&
    Boolean(process.env.DEEPSEEK_API_KEY?.trim())
  )
}

export const deepseekModelProvider = createModels({
  models: deepseekModels,
  routeIdentity: (model) => ({
    actualProvider: "cloudflare-ai-gateway",
    protocol: "openai-compatible",
    upstreamModel: `deepseek/${model.id}`,
  }),
  isConfigured: isDeepSeekConfigured,
  createProvider: () => (model) =>
    cloudflareGatewayChatModel({
      providerName: "deepseek",
      upstreamModel: model.id,
      upstreamApiKey: apiKey(),
      gatewayModel: `deepseek/${model.id}`,
    }),
})
