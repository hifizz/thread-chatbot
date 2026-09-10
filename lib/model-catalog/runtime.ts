import { normalizeTokenRouterBody } from "@/lib/ai/llm/token-router-request"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ModelRouteIdentity } from "@/lib/ai/llm/create-models"
import { normalizeTokenRouterBaseURL } from "@/lib/ai/llm/token-router-config"
import type { CatalogModel } from "./schema"

/** 捕获本次生成的配置，transform 不再回读全局目录。 */
export function normalizeCatalogRequest(body: Record<string, unknown>, model: CatalogModel) {
  const { profile, toolCalling, defaultEffort } = model.config
  const policy = profile === "deepseek" ? { thinking: "optional" as const, toolChoice: "omit" as const }
    : profile === "glm" ? { thinking: "required" as const, toolChoice: "auto" as const }
    : profile === "thinking-required" ? { thinking: "required" as const, toolChoice: "omit" as const }
    : undefined
  return normalizeTokenRouterBody(body, { completionTokens: profile === "gpt", policy, toolCalling, defaultEffort: defaultEffort ?? undefined })
}
export function resolveCatalogLanguageModel(snapshot: CatalogModel) {
  const apiKey = process.env.TOKEN_ROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error("Token Router 未配置 API Key")
  const baseURL = normalizeTokenRouterBaseURL()
  const anthropic = snapshot.config.profile.startsWith("anthropic")
  const route: ModelRouteIdentity = {
    actualProvider: "token-router", protocol: anthropic ? "anthropic" : "openai-compatible", upstreamModel: snapshot.config.upstreamId,
  }
  const model = anthropic
    ? createAnthropic({ name: "token-router-anthropic", baseURL, apiKey })(snapshot.config.upstreamId)
    : createOpenAICompatible({ name: "token-router", baseURL, apiKey, includeUsage: true, transformRequestBody: (body) => normalizeCatalogRequest(body, snapshot) })(snapshot.config.upstreamId)
  return { model, route }
}
