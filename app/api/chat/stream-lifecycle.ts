import type { ProviderMetadata } from "ai"
import type { ChatModel } from "@/constants/model"
import { GENERATION_ERRORS } from "@/constants/generation"
import { usageCostEvidence } from "@/lib/billing/usage-cost-evidence"
import { settleGeneration } from "@/lib/billing/reservations"
import { usdToMicros } from "@/constants/pricing"
import type { OpenRouterStepLike } from "@/lib/ai/llm/openrouter"
import { logger } from "@/lib/axiom/server"
import { safeErrorMetadata } from "@/lib/observability/error"

type UsageStep = OpenRouterStepLike & {
  usage: {
    inputTokens?: number
    outputTokens?: number
  }
}

type StreamLifecycleInput = {
  userId: string
  modelId: string
  model: Pick<ChatModel, "id" | "provider">
  unbilledPreview: boolean
  linearThreadId?: string
  generationId: string
}

type StreamLifecycleDependencies = {
  settle: typeof settleGeneration
}

const defaultDependencies: StreamLifecycleDependencies = {
  settle: settleGeneration,
}

/** 请求级 stream usage/error 状态；handler 写入，持久化终态只读取 snapshot。 */
export function createStreamLifecycle(
  {
    userId,
    modelId,
    model,
    unbilledPreview,
    linearThreadId,
    generationId,
  }: StreamLifecycleInput,
  dependencies: StreamLifecycleDependencies = defaultDependencies
) {
  let modelStreamError: string | undefined

  return {
    onError({ error }: { error: unknown }) {
      modelStreamError = GENERATION_ERRORS.streamFailed
      logger.error("chat.model_stream.error", {
        modelId,
        provider: model.provider,
        threadId: linearThreadId,
        ...safeErrorMetadata(error),
      })
    },

    onAbort() {},

    async onEnd({
      usage,
      providerMetadata,
      steps,
    }: {
      usage: { inputTokens?: number; outputTokens?: number }
      providerMetadata?: ProviderMetadata
      steps: readonly UsageStep[]
    }) {
      if (unbilledPreview) return
      const costEvidence = usageCostEvidence({
        provider: model.provider,
        steps,
        providerMetadata,
      })
      if (
        model.provider === "openrouter" &&
        costEvidence.source !== "openrouter"
      ) {
        logger.warn("billing.cost_fallback", {
          provider: model.provider,
          modelId: model.id,
          costSource: costEvidence.source,
        })
      }
      await dependencies.settle({
        generationId,
        userId,
        modelId,
        threadId: linearThreadId ?? null,
        providerUsage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        },
        ...(costEvidence.source === "openrouter"
          ? {
              providerCostMicros: usdToMicros(costEvidence.costUsd),
              costSource: "openrouter" as const,
            }
          : {}),
      })
    },

    snapshot() {
      return {
        modelStreamError,
      }
    },
  }
}

export type StreamLifecycle = ReturnType<typeof createStreamLifecycle>
