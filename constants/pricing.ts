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
 * 美元 → 人民币汇率。供应商（OpenAI/DeepSeek 国际站/Vercel 网关）多以美元计价，
 * 而我们的额度以人民币「微元」结算，故统一按此汇率折算。可用环境变量覆盖。
 * ⚠️ 汇率是业务数字，建议留出缓冲（宁高勿低）以吸收波动，保住 ≥30% 利润。
 */
export const USD_TO_CNY = Number(process.env.USD_TO_CNY) || 7.3

export type Currency = "CNY" | "USD"

/**
 * 各模型的供应商成本价（每 100 万 token，按模型**原生币种**填写，输入/输出分开）。
 * 币种精确后不用再手动把美元「近似」成人民币——折算交给 USD_TO_CNY。
 * ⚠️ 仍是业务数字：请按供应商实际计费页核对；只要此处成本 ≥ 真实成本，
 * 加价公式即可保证 ≥30% 利润。key 为模型注册表 id（见 constants/model.ts）。
 *
 * 注：若走 Vercel AI 网关，真实成本会在对账阶段用网关回传值覆盖此估算
 * （见 lib/billing/credits.ts 的 reconcile），此表作为即时扣费与回退基准。
 */
export type ModelCost = {
  currency: Currency
  /** 输入 token 成本：币种/1M tokens */
  inputPerMillion: number
  /** 输出 token 成本：币种/1M tokens */
  outputPerMillion: number
}

export const MODEL_COST: Record<string, ModelCost> = {
  // MiniMax M2（直连）— 人民币计价，参考官方定价，请以实际账单为准
  "minimax-m2": {
    currency: "CNY",
    inputPerMillion: 1.2,
    outputPerMillion: 2.4,
  },
  // DeepSeek V3.2 — 官方美元价（deepseek-chat）
  "deepseek-chat": {
    currency: "USD",
    inputPerMillion: 0.28,
    outputPerMillion: 0.42,
  },
  // OpenAI GPT-4o mini — 官方美元价
  "gpt-4o-mini": {
    currency: "USD",
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
  },
}

/** 把某币种金额折算成微元。 */
export function toMicros(amount: number, currency: Currency): number {
  const yuan = currency === "USD" ? amount * USD_TO_CNY : amount
  return yuan * MICROS_PER_YUAN
}

/** 美元金额 → 微元（对账阶段用网关回传的 USD 成本折算）。 */
export function usdToMicros(usd: number): number {
  return Math.ceil(toMicros(usd, "USD"))
}

/** 供应商成本（微元）。找不到定价的模型按 0 处理（等价免费，需在注册表里避免）。 */
export function costMicros(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const cost = MODEL_COST[model]
  if (!cost) return 0
  const native =
    (inputTokens * cost.inputPerMillion +
      outputTokens * cost.outputPerMillion) /
    1_000_000
  return Math.ceil(toMicros(native, cost.currency))
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
