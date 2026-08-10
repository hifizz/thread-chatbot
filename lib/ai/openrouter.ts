import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel, ProviderMetadata } from "ai"
import type { OpenRouterModelId } from "@/constants/model"

/** OpenRouter step 的最小成本元数据接口，便于纯函数验证。 */
export interface OpenRouterStepLike {
  providerMetadata?: ProviderMetadata
}

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim())
}

/** 固定使用 OpenRouter 专属 provider，并开启逐请求 usage accounting。 */
export function openRouterChatModel(modelId: OpenRouterModelId): LanguageModel {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error("OpenRouter 未配置 API Key")

  const httpReferer = process.env.OPENROUTER_HTTP_REFERER?.trim()
  const appTitle = process.env.OPENROUTER_APP_TITLE?.trim()
  const headers: Record<string, string> = {}
  if (httpReferer) headers["HTTP-Referer"] = httpReferer
  if (appTitle) headers["X-OpenRouter-Title"] = appTitle

  const provider = createOpenRouter({
    apiKey,
    compatibility: "strict",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  })
  return provider(modelId, { usage: { include: true } })
}

/** 仅当每个 step 都携带合法成本时返回完整美元成本。 */
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
