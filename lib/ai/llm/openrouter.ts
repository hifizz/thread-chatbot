import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel, ProviderMetadata } from "ai"
import { openrouterModels } from "@/constants/models"
import { createModels } from "@/lib/ai/llm/create-models"

let openrouterProvider: ReturnType<typeof createOpenRouter> | undefined

function getOpenRouterProvider() {
  if (openrouterProvider) return openrouterProvider
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error("OpenRouter 未配置 API Key")
  const httpReferer = process.env.OPENROUTER_HTTP_REFERER?.trim()
  const appTitle = process.env.OPENROUTER_APP_TITLE?.trim()
  const headers: Record<string, string> = {}
  if (httpReferer) headers["HTTP-Referer"] = httpReferer
  if (appTitle) headers["X-OpenRouter-Title"] = appTitle
  openrouterProvider = createOpenRouter({
    apiKey,
    compatibility: "strict",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  })
  return openrouterProvider
}

export interface OpenRouterStepLike {
  providerMetadata?: ProviderMetadata
}

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim())
}

export function openRouterChatModel(modelId: string): LanguageModel {
  return getOpenRouterProvider()(modelId, { usage: { include: true } })
}

export const openrouterModelProvider = createModels({
  models: openrouterModels,
  routeIdentity: (model) => ({
    actualProvider: "openrouter",
    protocol: "openrouter",
    upstreamModel: model.id,
  }),
  isConfigured: isOpenRouterConfigured,
  createProvider: () => (model) =>
    getOpenRouterProvider()(model.id, { usage: { include: true } }),
})

export function openRouterCostUsdFromSteps(
  steps: readonly OpenRouterStepLike[]
): number | null {
  if (steps.length === 0) return null
  let total = 0
  for (const step of steps) {
    const usage = step.providerMetadata?.openrouter?.usage
    const cost =
      usage && typeof usage === "object" && "cost" in usage
        ? usage.cost
        : undefined
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      return null
    }
    total += cost
  }
  return Number.isFinite(total) ? total : null
}
