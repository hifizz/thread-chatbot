import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { userCredits, usageRecords, payments } from "@/lib/db/schema"
import {
  INITIAL_CREDIT_MICROS,
  costMicros,
  priceMicros,
} from "@/constants/pricing"

// 用户额度与用量记账。金额单位为「微元」（见 constants/pricing.ts）。

/** 确保用户额度行存在；首次创建时赠送初始额度。幂等。 */
export async function ensureUserCredits(userId: string): Promise<void> {
  await db
    .insert(userCredits)
    .values({ userId, balanceMicros: INITIAL_CREDIT_MICROS })
    .onConflictDoNothing({ target: userCredits.userId })
}

/** 读取余额（微元）。无记录返回 0。 */
export async function getBalanceMicros(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: userCredits.balanceMicros })
    .from(userCredits)
    .where(eq(userCredits.userId, userId))
  return row?.balance ?? 0
}

/** 余额是否为正（是否允许发起新对话）。 */
export async function hasPositiveBalance(userId: string): Promise<boolean> {
  return (await getBalanceMicros(userId)) > 0
}

export type UsageInput = {
  userId: string
  model: string
  inputTokens: number
  outputTokens: number
  threadId?: string | null
  messageId?: string | null
}

export type ChargeResult = {
  costMicros: number
  priceMicros: number
  balanceMicros: number
}

/**
 * 按 token 用量扣费并写入流水。扣费用原子 SQL（余额不会扣成负数以下的额外校验交给
 * 发送前的 hasPositiveBalance 拦截；这里允许扣至负数以覆盖最后一条消息的成本）。
 */
export async function chargeUsage(input: UsageInput): Promise<ChargeResult> {
  const cost = costMicros(input.model, input.inputTokens, input.outputTokens)
  const price = priceMicros(input.model, input.inputTokens, input.outputTokens)

  await ensureUserCredits(input.userId)

  const [row] = await db
    .update(userCredits)
    .set({
      balanceMicros: sql`${userCredits.balanceMicros} - ${price}`,
      updatedAt: new Date(),
    })
    .where(eq(userCredits.userId, input.userId))
    .returning({ balance: userCredits.balanceMicros })

  await db.insert(usageRecords).values({
    id: randomUUID(),
    userId: input.userId,
    threadId: input.threadId ?? null,
    messageId: input.messageId ?? null,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costMicros: cost,
    priceMicros: price,
  })

  return {
    costMicros: cost,
    priceMicros: price,
    balanceMicros: row?.balance ?? 0,
  }
}

/** 给用户增加额度（充值到账）。确保额度行存在后原子累加，返回新余额。 */
export async function addCreditsMicros(
  userId: string,
  micros: number
): Promise<number> {
  if (micros <= 0) return getBalanceMicros(userId)
  await ensureUserCredits(userId)
  const [row] = await db
    .update(userCredits)
    .set({
      balanceMicros: sql`${userCredits.balanceMicros} + ${micros}`,
      updatedAt: new Date(),
    })
    .where(eq(userCredits.userId, userId))
    .returning({ balance: userCredits.balanceMicros })
  return row?.balance ?? 0
}

export type CreemTopupInput = {
  userId: string
  orderId: string
  checkoutId?: string | null
  productId?: string | null
  packId?: string | null
  creditMicros: number
  priceLabel?: string | null
  raw?: unknown
}

/**
 * 记录一笔 Creem 充值并到账，按 (provider, orderId) 幂等：
 * webhook 重放/重复投递时只会到账一次。返回是否本次到账及最新余额。
 */
export async function recordCreemTopup(
  input: CreemTopupInput
): Promise<{ granted: boolean; balanceMicros: number }> {
  // 幂等插入：同一订单已存在则不返回行 → 说明此前已处理，直接跳过到账
  const [inserted] = await db
    .insert(payments)
    .values({
      id: randomUUID(),
      userId: input.userId,
      provider: "creem",
      type: "topup",
      packId: input.packId ?? null,
      productId: input.productId ?? null,
      checkoutId: input.checkoutId ?? null,
      orderId: input.orderId,
      status: "paid",
      creditMicros: input.creditMicros,
      priceLabel: input.priceLabel ?? null,
      paidAt: new Date(),
      raw: input.raw ?? null,
    })
    .onConflictDoNothing({ target: [payments.provider, payments.orderId] })
    .returning({ id: payments.id })

  if (!inserted) {
    return {
      granted: false,
      balanceMicros: await getBalanceMicros(input.userId),
    }
  }

  const balanceMicros = await addCreditsMicros(input.userId, input.creditMicros)
  return { granted: true, balanceMicros }
}
