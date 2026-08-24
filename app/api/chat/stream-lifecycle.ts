import type { ProviderMetadata } from "ai"

import type { ChatModel } from "@/constants/model"
import { chargeUsage } from "@/lib/billing/credits"
import { usageCostEvidence } from "@/lib/billing/usage-cost-evidence"
import type { OpenRouterStepLike } from "@/lib/ai/openrouter"

type UsageStep = OpenRouterStepLike & {
  usage: { inputTokens?: number; outputTokens?: number }
}

type StreamLifecycleDependencies = { charge: typeof chargeUsage }

const defaultDependencies: StreamLifecycleDependencies = { charge: chargeUsage }

/** 线性聊天的模型流错误记录与 exactly-once 请求结算。 */
export function createLinearStreamLifecycle(
  input: {
    userId: string
    modelId: string
    model: Pick<ChatModel, "id" | "provider">
    unbilledPreview: boolean
    linearThreadId?: string
  },
  dependencies: StreamLifecycleDependencies = defaultDependencies
) {
  return {
    onError({ error }: { error: unknown }) {
      console.error("[chat] 模型流错误:", error)
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
      if (input.unbilledPreview) return
      const costEvidence = usageCostEvidence({
        provider: input.model.provider,
        steps,
        providerMetadata,
      })
      if (
        input.model.provider === "openrouter" &&
        costEvidence.source !== "openrouter"
      )
        console.warn(
          `[chat] OpenRouter 成本元数据不完整，使用静态估值：${input.model.id}`
        )
      await dependencies.charge({
        userId: input.userId,
        model: input.modelId,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        threadId: input.linearThreadId ?? null,
        costEvidence,
      })
    },
  }
}
