import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { tokenRouterModels } from "@/constants/models/token-router"
import { createModels } from "@/lib/ai/llm/create-models"

import { normalizeTokenRouterBaseURL, isTokenRouterConfigured } from "./token-router-config"
import { normalizeTokenRouterBody } from "./token-router-request"
export { normalizeTokenRouterBaseURL, isTokenRouterConfigured } from "./token-router-config"

function protocol(modelId: string) {
  return modelId.startsWith("claude-") ? "anthropic" : "openai-compatible"
}

/** 在发送前适配模型差异；不改变其他渠道、模型或历史消息。 */
export function normalizeTokenRouterRequest(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.model !== "string") return body
  const model = tokenRouterModels.models.find((entry) => entry.id === body.model)
  return normalizeTokenRouterBody(body, {
    completionTokens: body.model.startsWith("gpt-"),
    policy: model && "requestPolicy" in model ? model.requestPolicy : undefined,
  })
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
      transformRequestBody: normalizeTokenRouterRequest,
    })
    return (model) => protocol(model.id) === "anthropic"
      ? anthropic(model.id)
      : openai(model.id)
  },
})
