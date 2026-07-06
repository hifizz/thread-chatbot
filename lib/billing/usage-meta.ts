import { costMicros, priceMicros } from "@/constants/pricing"

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
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    costMicros: costMicros(model, inputTokens, outputTokens),
    priceMicros: priceMicros(model, inputTokens, outputTokens),
  }
}
