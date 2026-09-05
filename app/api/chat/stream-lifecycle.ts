import type { ProviderMetadata } from "ai"
import type { ChatModel } from "@/constants/model"
import { GENERATION_ERRORS } from "@/constants/generation"
import { chargeUsage } from "@/lib/billing/credits"
import { usageCostEvidence } from "@/lib/billing/usage-cost-evidence"
import type { OpenRouterStepLike } from "@/lib/ai/llm/openrouter"

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
    unbilledPreview,
    linearThreadId,
  }: StreamLifecycleInput,
  dependencies: StreamLifecycleDependencies = defaultDependencies
) {
  let modelStreamError: string | undefined

  return {
    onError({ error }: { error: unknown }) {
      modelStreamError = GENERATION_ERRORS.streamFailed
      console.error("[chat] 模型流错误:", error)
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
        console.warn(
          `[chat] OpenRouter 成本元数据不完整，使用静态估值：${model.id}`
        )
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
        modelStreamError,
      }
    },
  }
}

export type StreamLifecycle = ReturnType<typeof createStreamLifecycle>
