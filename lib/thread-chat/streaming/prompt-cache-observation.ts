import type { LanguageModelUsage } from "ai"
import type {
  PromptCacheObservation,
  PromptCacheRouteIdentity,
  ThreadChatGenerationModeId,
} from "@/lib/thread-chat/contracts/prompt-cache"

export interface PromptCacheObservationContext {
  route: PromptCacheRouteIdentity
  generationMode: ThreadChatGenerationModeId
  promptSchemaVersion: string
  projectContractVersion: number
  explicitCacheEnabled: boolean
}

function definedNumber(value: number | undefined): number | undefined {
  return typeof value === "number" ? value : undefined
}

export function buildPromptCacheObservation(
  usage: LanguageModelUsage | undefined,
  context: PromptCacheObservationContext
): PromptCacheObservation {
  const inputTokens = definedNumber(usage?.inputTokens)
  const noCacheTokens = definedNumber(usage?.inputTokenDetails.noCacheTokens)
  const cacheReadTokens = definedNumber(
    usage?.inputTokenDetails.cacheReadTokens
  )
  const cacheWriteTokens = definedNumber(
    usage?.inputTokenDetails.cacheWriteTokens
  )
  const outputTokens = definedNumber(usage?.outputTokens)
  const status =
    cacheReadTokens === undefined
      ? "unknown"
      : cacheReadTokens > 0
        ? "hit"
        : "miss"

  const hasDetailedInput =
    noCacheTokens !== undefined &&
    cacheReadTokens !== undefined &&
    cacheWriteTokens !== undefined
  const detailedDenominator = hasDetailedInput
    ? noCacheTokens + cacheReadTokens + cacheWriteTokens
    : undefined
  const fallbackDenominator =
    !hasDetailedInput &&
    inputTokens !== undefined &&
    cacheReadTokens !== undefined
      ? inputTokens
      : undefined
  const denominator = detailedDenominator ?? fallbackDenominator
  const metricFormula = hasDetailedInput
    ? "detailed-input"
    : fallbackDenominator !== undefined
      ? "input-total"
      : "unavailable"

  return {
    status,
    route: context.route,
    generationMode: context.generationMode,
    promptSchemaVersion: context.promptSchemaVersion,
    projectContractVersion: context.projectContractVersion,
    explicitCacheEnabled: context.explicitCacheEnabled,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(noCacheTokens !== undefined ? { noCacheTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    metricFormula,
    ...(denominator !== undefined && denominator > 0
      ? { tokenHitRate: cacheReadTokens! / denominator }
      : {}),
  }
}

/** 观测失败只能降级为日志告警，不能影响生成、持久化或终态。 */
export function reportPromptCacheObservation(
  observation: PromptCacheObservation
): void {
  try {
    console.info(
      "[thread-chat-prompt-cache]",
      JSON.stringify({
        status: observation.status,
        actualProvider: observation.route.actualProvider,
        protocol: observation.route.protocol,
        credentialGroup: observation.route.credentialGroup,
        upstreamModel: observation.route.upstreamModel,
        generationMode: observation.generationMode,
        promptSchemaVersion: observation.promptSchemaVersion,
        projectContractVersion: observation.projectContractVersion,
        explicitCacheEnabled: observation.explicitCacheEnabled,
        inputTokens: observation.inputTokens,
        noCacheTokens: observation.noCacheTokens,
        cacheReadTokens: observation.cacheReadTokens,
        cacheWriteTokens: observation.cacheWriteTokens,
        outputTokens: observation.outputTokens,
        metricFormula: observation.metricFormula,
        tokenHitRate: observation.tokenHitRate,
      })
    )
  } catch (error) {
    console.warn("[thread-chat] Prompt 缓存摘要日志失败:", error)
  }
}
