// 计费口径与模型定价（单一事实来源）。
//
// 目标：向用户收取的价格相对供应商成本「利润率 ≥ 30%」，即
//   售价 = 成本 / (1 - PROFIT_MARGIN)。PROFIT_MARGIN=0.3 时售价 ≈ 1.4286×成本，
//   利润 =(售价-成本)/售价 = 30%。计算时对微元向上取整，保证不低于目标利润。
//
// 金额单位统一为「微元」整数：1 元 = 1_000_000 微元。

/** 目标利润率（占售价比例）。至少 30%。 */
export const PROFIT_MARGIN = 0.3

/** 1 元对应的微元数。 */
export const MICROS_PER_YUAN = 1_000_000

/** 新用户注册赠送的初始额度（微元）。默认 ¥5。 */
export const INITIAL_CREDIT_MICROS = 5 * MICROS_PER_YUAN

/**
 * 各模型的供应商成本价（元 / 每 100 万 token），输入/输出分别计价。
 * ⚠️ 这些是业务数字：请按供应商实际计费页核对后调整；只要此处成本 ≥ 真实成本，
 * 加价公式即可保证 ≥30% 利润。key 为模型注册表 id（见 constants/models.ts）。
 */
export type ModelCost = {
  /** 输入 token 成本：元 / 1M tokens */
  inputPerMillion: number
  /** 输出 token 成本：元 / 1M tokens */
  outputPerMillion: number
}

export const MODEL_COST: Record<string, ModelCost> = {
  // MiniMax M2（直连）— 参考官方定价，请以实际账单为准
  "minimax-m2": { inputPerMillion: 1.2, outputPerMillion: 2.4 },
  // DeepSeek V3.2（经 CF AI 网关）
  "deepseek-chat": { inputPerMillion: 2, outputPerMillion: 3 },
  // OpenAI GPT-4o mini（经 CF AI 网关）— 美元价换算，这里按人民币近似填入，请核对
  "gpt-4o-mini": { inputPerMillion: 1.1, outputPerMillion: 4.3 },
}

/** 供应商成本（微元）。找不到定价的模型按 0 处理（等价免费，需在注册表里避免）。 */
export function costMicros(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const cost = MODEL_COST[model]
  if (!cost) return 0
  const micros =
    (inputTokens * cost.inputPerMillion +
      outputTokens * cost.outputPerMillion) *
    (MICROS_PER_YUAN / 1_000_000)
  return Math.ceil(micros)
}

/** 由成本换算售价（微元），保证利润率 ≥ PROFIT_MARGIN，向上取整。 */
export function priceFromCost(costMicros: number): number {
  if (costMicros <= 0) return 0
  return Math.ceil(costMicros / (1 - PROFIT_MARGIN))
}

/** 一次调用应向用户收取的价格（微元）。 */
export function priceMicros(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  return priceFromCost(costMicros(model, inputTokens, outputTokens))
}

/** 某模型对用户的售价（元 / 每 100 万 token），输入/输出分别计。用于选择器展示。 */
export function sellPricePerMillionYuan(model: string): {
  input: number
  output: number
} {
  return {
    input: microsToYuan(priceMicros(model, 1_000_000, 0)),
    output: microsToYuan(priceMicros(model, 0, 1_000_000)),
  }
}

/** 微元 → 元（保留 4 位小数，用于展示）。 */
export function microsToYuan(micros: number): number {
  return micros / MICROS_PER_YUAN
}

/** 格式化为「¥x.xxxx」，小额费用也能看清。 */
export function formatYuan(micros: number, fractionDigits = 4): string {
  return `¥${microsToYuan(micros).toFixed(fractionDigits)}`
}
