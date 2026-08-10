import { costMicros, priceMicros } from "../../constants/pricing.ts"
import {
  EMPTY_EXTERNAL_USAGE,
  type ExternalUsageSummary,
} from "./external-usage.ts"

export {
  createExternalUsageAccumulator,
  EMPTY_EXTERNAL_USAGE,
} from "./external-usage.ts"
export type {
  ExternalUsageCharge,
  ExternalUsageSummary,
} from "./external-usage.ts"

// 附加到 assistant 消息 metadata 的用量信息（随消息持久化，前端 token 统计据此展示）。

export type UsageMetadata = {
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** 顶层金额为模型 + 外部工具总额；旧消息没有 breakdown 时仍可直接读取。 */
  costMicros: number
  priceMicros: number
  modelCostMicros: number
  modelPriceMicros: number
  externalUsage: ExternalUsageSummary
}

export function buildUsageMetadata(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  externalUsage: ExternalUsageSummary = EMPTY_EXTERNAL_USAGE
): UsageMetadata {
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const modelCostMicros = costMicros(model, inputTokens, outputTokens)
  const modelPriceMicros = priceMicros(model, inputTokens, outputTokens)
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    costMicros: modelCostMicros + externalUsage.costMicros,
    priceMicros: modelPriceMicros + externalUsage.priceMicros,
    modelCostMicros,
    modelPriceMicros,
    externalUsage: { ...externalUsage },
  }
}
