import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { userCredits, usageRecords } from "@/lib/db/schema"
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
