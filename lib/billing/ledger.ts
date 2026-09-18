import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { INITIAL_CREDIT_MICROS } from "@/constants/pricing"
import { db } from "@/lib/db"
import { creditLedger, userCredits } from "@/lib/db/schema"
import type { BillingTransaction } from "@/lib/billing/credits"

export type LedgerKind =
  | "opening_balance"
  | "grant"
  | "charge"
  | "refund"
  | "adjustment"

export async function appendLedgerEntryOnce(
  tx: BillingTransaction,
  input: {
    userId: string
    kind: LedgerKind
    amountMicros: number
    idempotencyKey: string
    referenceId: string
    reason: string
    actorId?: string | null
  }
): Promise<boolean> {
  if (!Number.isSafeInteger(input.amountMicros))
    throw new RangeError("账本金额必须是安全整数")
  const [inserted] = await tx
    .insert(creditLedger)
    .values({
      id: randomUUID(),
      ...input,
      actorId: input.actorId ?? null,
    })
    .onConflictDoNothing({ target: creditLedger.idempotencyKey })
    .returning({ id: creditLedger.id })
  if (!inserted) return false
  await tx
    .update(userCredits)
    .set({
      balanceMicros: sql`${userCredits.balanceMicros} + ${input.amountMicros}`,
      updatedAt: new Date(),
    })
    .where(eq(userCredits.userId, input.userId))
  return true
}

async function grantWelcomeCreditsInTransaction(
  tx: BillingTransaction,
  userId: string
): Promise<{ granted: boolean; balanceMicros: number }> {
  const [created] = await tx
    .insert(userCredits)
    .values({ userId, balanceMicros: 0 })
    .onConflictDoNothing({ target: userCredits.userId })
    .returning({ userId: userCredits.userId })

  const [account] = await tx
    .select({ balanceMicros: userCredits.balanceMicros })
    .from(userCredits)
    .where(eq(userCredits.userId, userId))
    .for("update")
  if (!account) throw new Error("BILLING_ACCOUNT_NOT_FOUND")

  // 历史账户在引入 ledger 前已经收到过赠额；只登记期初余额，不再次加钱。
  if (!created) {
    await tx
      .insert(creditLedger)
      .values({
        id: randomUUID(),
        userId,
        kind: "opening_balance",
        amountMicros: account.balanceMicros,
        idempotencyKey: `opening-balance-v1:${userId}`,
        referenceId: userId,
        reason: "迁移前账户期初余额",
        actorId: null,
      })
      .onConflictDoNothing({ target: creditLedger.idempotencyKey })
    return { granted: false, balanceMicros: account.balanceMicros }
  }

  const granted = await appendLedgerEntryOnce(tx, {
    userId,
    kind: "grant",
    amountMicros: INITIAL_CREDIT_MICROS,
    idempotencyKey: `beta-welcome-v1:${userId}`,
    referenceId: userId,
    reason: "Beta 欢迎额度",
  })
  return {
    granted,
    balanceMicros: account.balanceMicros + (granted ? INITIAL_CREDIT_MICROS : 0),
  }
}

/** 邮箱验证或邀请激活调用；重复回调不会重复赠送。 */
export function grantWelcomeCreditsOnce(userId: string) {
  return db.transaction((tx) => grantWelcomeCreditsInTransaction(tx, userId))
}

