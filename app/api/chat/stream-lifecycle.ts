import type { ProviderMetadata } from "ai"
import type { ChatModel } from "@/constants/model"
import { GENERATION_ERRORS } from "@/constants/generation"
import { chargeUsage } from "@/lib/billing/credits"
import { usageCostEvidence } from "@/lib/billing/usage-cost-evidence"
import type { OpenRouterStepLike } from "@/lib/ai/openrouter"
import type { FinalizeGenerationUsage } from "@/lib/thread-chat-generation/finalize"

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
  persistentGeneration: boolean
  unbilledPreview: boolean
  linearThreadId?: string
}

type StreamLifecycleDependencies = {
  charge: typeof chargeUsage
}

const defaultDependencies: StreamLifecycleDependencies = {
  charge: chargeUsage,
}

/** 请求级 stream usage/error 状态；handler 写入，持久化终态只读取 snapshot。 */
export function createStreamLifecycle(
  {
    userId,
    modelId,
    model,
    persistentGeneration,
    unbilledPreview,
    linearThreadId,
  }: StreamLifecycleInput,
  dependencies: StreamLifecycleDependencies = defaultDependencies
) {
  let capturedUsage: FinalizeGenerationUsage | undefined
  let capturedProviderMetadata: unknown
  let modelStreamError: string | undefined
  let abortedUsageUnavailable = false

  return {
    onError({ error }: { error: unknown }) {
      modelStreamError =
        error instanceof Error ? error.message : GENERATION_ERRORS.streamFailed
      console.error("[chat] 模型流错误:", error)
    },

    onAbort({ steps }: { steps: readonly UsageStep[] }) {
      if (!persistentGeneration) return
      const inputTokens = steps.reduce(
        (total, step) => total + (step.usage.inputTokens ?? 0),
        0
      )
      const outputTokens = steps.reduce(
        (total, step) => total + (step.usage.outputTokens ?? 0),
        0
      )
      const providerMetadata = steps.at(-1)?.providerMetadata
      if (steps.length > 0) {
        capturedUsage = {
          inputTokens,
          outputTokens,
          costEvidence: usageCostEvidence({
            provider: model.provider,
            steps,
            providerMetadata,
          }),
        }
        capturedProviderMetadata = providerMetadata
      }
      abortedUsageUnavailable = true
    },

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
        console.warn(
          `[chat] OpenRouter 成本元数据不完整，使用静态估值：${model.id}`
        )
      }
      if (persistentGeneration) {
        capturedUsage = {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          costEvidence,
        }
        capturedProviderMetadata = providerMetadata
        return
      }
      await dependencies.charge({
        userId,
        model: modelId,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        threadId: linearThreadId ?? null,
        costEvidence,
      })
    },

    snapshot() {
      return {
        capturedUsage,
        capturedProviderMetadata,
        modelStreamError,
        abortedUsageUnavailable,
      }
    },
  }
}
