import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import type { UMAPISCredentialGroup, UMAPISModelId } from "@/constants/model"

export const DEFAULT_UMAPIS_BASE_URL = "https://www.umapis.com/v1"

/** UMAPIS 控制台可配置站点根路径或 API 根路径；adapter 统一使用 `/v1` API 根。 */
export function normalizeUMAPISBaseURL(
  baseURL: string | undefined = process.env.UMAPIS_BASE_URL
): string {
  const configured = baseURL?.trim()
  const normalized = (configured || DEFAULT_UMAPIS_BASE_URL).replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

export function getUMAPISApiKey(
  credentialGroup: UMAPISCredentialGroup
): string | undefined {
  const key =
    credentialGroup === "claude"
      ? process.env.UMAPIS_API_KEY_CLAUDE
      : process.env.UMAPIS_API_KEY_GPT
  const trimmed = key?.trim()
  return trimmed || undefined
}

export function isUMAPISConfigured(
  credentialGroup: UMAPISCredentialGroup
): boolean {
  return Boolean(getUMAPISApiKey(credentialGroup))
}

/** 使用模型所属凭据组创建 UMAPIS OpenAI-compatible 聊天模型。 */
export function umapisChatModel(
  modelId: UMAPISModelId,
  credentialGroup: UMAPISCredentialGroup
): LanguageModel {
  const apiKey = getUMAPISApiKey(credentialGroup)
  if (!apiKey) {
    throw new Error(`UMAPIS ${credentialGroup.toUpperCase()} 组未配置 API Key`)
  }

  const provider = createOpenAICompatible({
    name: "umapis",
    baseURL: normalizeUMAPISBaseURL(),
    apiKey,
    includeUsage: true,
  })

  return provider(modelId)
}
