// Beta 计费准入与结算策略。金额仍以 constants/pricing.ts 的微元为唯一单位。

export const BILLING_POLICY_VERSION = "beta-margin-30-v1"

/** 预占必须覆盖输入上下文；真实上下文上限接入前使用保守的产品边界。 */
export const BILLING_RESERVED_INPUT_TOKENS = 128_000

/** held 过期只进入恢复检查，不能直接释放或重放付费请求。 */
export const BILLING_RESERVATION_TTL_MS = 20 * 60 * 1_000

/** 每个账户允许的活跃付费生成数；数据库账户行锁保证跨实例一致。 */
export const BILLING_MAX_ACTIVE_RESERVATIONS = 3

/** Beta 期间不创建新支付；历史已支付 webhook 仍必须照常验签和履约。 */
export const NEW_CHECKOUTS_ENABLED = false
