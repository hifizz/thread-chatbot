import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"

/** 私有模型中继可配置服务根地址或 API 根地址；统一规范为恰好一个 `/v1` 后缀。 */
export function normalizePrivateRelayBaseURL(
  baseURL: string | undefined = process.env.PRIVATE_RELAY_BASE_URL
): string {
  const configured = baseURL?.trim()
  if (!configured) throw new Error("私有模型中继未配置 Base URL")
  const normalized = configured.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

export function isPrivateRelayConfigured(): boolean {
  return Boolean(
    process.env.PRIVATE_RELAY_BASE_URL?.trim() &&
    process.env.PRIVATE_RELAY_API_KEY?.trim()
  )
}

/** 私有模型中继固定使用独立 OpenAI-compatible provider，不参与通用网关回退。 */
export function privateRelayChatModel(modelId: string): LanguageModel {
  const apiKey = process.env.PRIVATE_RELAY_API_KEY?.trim()
  if (!apiKey) throw new Error("私有模型中继未配置 API Key")

  const privateRelay = createOpenAICompatible({
    name: "private-relay",
    baseURL: normalizePrivateRelayBaseURL(),
    apiKey,
    includeUsage: true,
  })

  return privateRelay(modelId)
}
