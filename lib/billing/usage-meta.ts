import { costMicros, priceMicros } from "@/constants/pricing"
import { getChatModel, isUnbilledPreviewModel } from "@/constants/model"

// 附加到 assistant 消息 metadata 的用量信息（随消息持久化，前端 token 统计据此展示）。

export type UsageMetadata = {
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costMicros: number
  priceMicros: number
}

export function buildUsageMetadata(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
): UsageMetadata {
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const registeredModel = getChatModel(model)
  const unbilledPreview =
    registeredModel !== undefined && isUnbilledPreviewModel(registeredModel)
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    costMicros: unbilledPreview
      ? 0
      : costMicros(model, inputTokens, outputTokens),
    priceMicros: unbilledPreview
      ? 0
      : priceMicros(model, inputTokens, outputTokens),
  }
}
