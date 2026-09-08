import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { tokenRouterModels } from "@/constants/models/token-router"
import { createModels } from "@/lib/ai/llm/create-models"

export function normalizeTokenRouterBaseURL(
  baseURL: string | undefined = process.env.TOKEN_ROUTER_BASE_URL
): string {
  const configured = baseURL?.trim()
  if (!configured) throw new Error("Token Router 未配置 Base URL")
  const normalized = configured.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

export function isTokenRouterConfigured(): boolean {
  return Boolean(
    process.env.TOKEN_ROUTER_BASE_URL?.trim() &&
    process.env.TOKEN_ROUTER_API_KEY?.trim()
  )
}

function protocol(modelId: string) {
  return modelId.startsWith("claude-") ? "anthropic" : "openai-compatible"
}

/** 一个中转服务、一组凭据；按模型族保留对应的原生请求协议。 */
export const tokenRouterModelProvider = createModels({
  models: tokenRouterModels,
  routeIdentity: (model) => ({
    actualProvider: tokenRouterModels.id,
    protocol: protocol(model.id),
    upstreamModel: model.id,
  }),
  isConfigured: isTokenRouterConfigured,
  createProvider: () => {
    const baseURL = normalizeTokenRouterBaseURL()
    const apiKey = process.env.TOKEN_ROUTER_API_KEY?.trim()
    if (!apiKey) throw new Error("Token Router 未配置 API Key")
    const anthropic = createAnthropic({
      name: `${tokenRouterModels.id}-anthropic`, baseURL, apiKey,
    })
    const openai = createOpenAICompatible({
      name: tokenRouterModels.id, baseURL, apiKey, includeUsage: true,
      transformRequestBody: (body) => {
        // GPT 的上限包含 reasoning tokens；Gemini 保留兼容接口的 max_tokens。
        if (typeof body.model !== "string" || !body.model.startsWith("gpt-")) return body
        const { max_tokens, ...rest } = body
        return { ...rest, ...(max_tokens !== undefined ? { max_completion_tokens: max_tokens } : {}) }
      },
    })
    return (model) => protocol(model.id) === "anthropic"
      ? anthropic(model.id)
      : openai(model.id)
  },
})
