// Creem 充值 / 订阅相关常量。金额与额度沿用「微元」（1 元 = 1_000_000 微元，见 constants/pricing.ts）。
//
// 充值包把「Creem 产品」映射为「到账额度」：
//   - priceLabel / 实际收款价由 Creem 后台的产品定价决定（此处仅展示用，需与后台一致）
//   - creditMicros 是我们在 webhook 成功后给用户增加的额度
//   - productId 从环境变量读取（账号相关，不硬编码），缺失则该包不可购买
//
// 订阅同理：套餐产品 id 从环境变量读取，webhook 里按 productId 反查套餐。

import { MICROS_PER_YUAN } from "./pricing"

export type TopupPack = {
  /** 内部 id，前后端与 metadata 用它标识充值包 */
  id: string
  name: string
  /** 展示价（需与 Creem 后台该产品定价一致） */
  priceLabel: string
  /** 支付成功后到账额度（微元） */
  creditMicros: number
  /** 对应 Creem 产品 id 的环境变量名 */
  productIdEnv: string
  /** 营销标签，如「送 ¥10」 */
  bonusLabel?: string
}

export const TOPUP_PACKS: readonly TopupPack[] = [
  {
    id: "topup-20",
    name: "入门充值包",
    priceLabel: "¥20",
    creditMicros: 20 * MICROS_PER_YUAN,
    productIdEnv: "CREEM_PRODUCT_TOPUP_20",
  },
  {
    id: "topup-50",
    name: "标准充值包",
    priceLabel: "¥50",
    creditMicros: 55 * MICROS_PER_YUAN, // 送 ¥5
    productIdEnv: "CREEM_PRODUCT_TOPUP_50",
    bonusLabel: "送 ¥5",
  },
  {
    id: "topup-100",
    name: "超值充值包",
    priceLabel: "¥100",
    creditMicros: 115 * MICROS_PER_YUAN, // 送 ¥15
    productIdEnv: "CREEM_PRODUCT_TOPUP_100",
    bonusLabel: "送 ¥15",
  },
]

export function getTopupPack(id: string | undefined): TopupPack | undefined {
  return TOPUP_PACKS.find((p) => p.id === id)
}

/** 解析充值包对应的 Creem 产品 id（环境变量）；未配置返回 undefined。 */
export function topupProductId(pack: TopupPack): string | undefined {
  return process.env[pack.productIdEnv] || undefined
}

/** 该充值包是否可购买（已配置 Creem 产品 id）。 */
export function isTopupPackAvailable(pack: TopupPack): boolean {
  return Boolean(topupProductId(pack))
}

/**
 * 订阅套餐：productId ↔ 套餐信息映射。用环境变量 CREEM_SUBSCRIPTION_PRODUCTS
 * （形如 "prod_a:pro,prod_b:team"）声明；webhook 收到订阅事件时按 productId 反查。
 * 现阶段仅用于在账户页展示订阅名，扣费仍走额度体系。
 */
export function subscriptionPlanName(
  productId: string | null | undefined
): string | undefined {
  if (!productId) return undefined
  const raw = process.env.CREEM_SUBSCRIPTION_PRODUCTS
  if (!raw) return undefined
  for (const pair of raw.split(",")) {
    const [pid, name] = pair.split(":").map((s) => s.trim())
    if (pid === productId) return name
  }
  return undefined
}
