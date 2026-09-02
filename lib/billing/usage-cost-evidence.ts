import type { ChatModelProvider } from "@/constants/model"
import {
  openRouterCostUsdFromSteps,
  type OpenRouterStepLike,
} from "@/lib/ai/openrouter"
import type { UsageCostEvidence } from "@/lib/billing/credits"

type UsageCostEvidenceInput = {
  provider: ChatModelProvider
  steps: readonly OpenRouterStepLike[]
  providerMetadata: unknown
}

function gatewayGenerationId(providerMetadata: unknown): string | null {
  if (typeof providerMetadata !== "object" || providerMetadata === null)
    return null
  const gateway = Reflect.get(providerMetadata, "gateway")
  if (typeof gateway !== "object" || gateway === null) return null
  const generationId = Reflect.get(gateway, "generationId")
  return typeof generationId === "string" ? generationId : null
}

/** 实际成本优先，其次可追溯的 Gateway generation，最后使用静态估值。 */
export function usageCostEvidence({
  provider,
  steps,
  providerMetadata,
}: UsageCostEvidenceInput): UsageCostEvidence {
  const openRouterCostUsd =
    provider === "openrouter" ? openRouterCostUsdFromSteps(steps) : null
  if (openRouterCostUsd != null) {
    return { source: "openrouter", costUsd: openRouterCostUsd }
  }

  const generationId = gatewayGenerationId(providerMetadata)
  return generationId
    ? { source: "vercel-gateway", generationId }
    : { source: "estimate" }
}
