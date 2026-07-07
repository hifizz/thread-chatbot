import { desc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { payments, subscriptions, usageRecords } from "@/lib/db/schema"
import { getBalanceMicros, ensureUserCredits } from "@/lib/billing/credits"

// 账户页所需的聚合数据：余额、充值/消耗流水、订阅、累计统计。

export type AccountPayment = {
  id: string
  type: string
  packId: string | null
  priceLabel: string | null
  creditMicros: number
  status: string
  createdAt: string
  paidAt: string | null
}

export type AccountUsage = {
  id: string
  model: string
  inputTokens: number
  outputTokens: number
  priceMicros: number
  createdAt: string
}

export type AccountSubscription = {
  subscriptionId: string
  productId: string | null
  status: string
  currentPeriodEnd: string | null
}

export type AccountData = {
  balanceMicros: number
  totalToppedUpMicros: number
  totalSpentMicros: number
  payments: AccountPayment[]
  usage: AccountUsage[]
  subscription: AccountSubscription | null
}

export async function getAccountData(userId: string): Promise<AccountData> {
  await ensureUserCredits(userId)
  const balanceMicros = await getBalanceMicros(userId)

  const [paymentRows, usageRows, subRows, topupAgg, spendAgg] =
    await Promise.all([
      db
        .select()
        .from(payments)
        .where(eq(payments.userId, userId))
        .orderBy(desc(payments.createdAt))
        .limit(20),
      db
        .select()
        .from(usageRecords)
        .where(eq(usageRecords.userId, userId))
        .orderBy(desc(usageRecords.createdAt))
        .limit(20),
      db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.updatedAt))
        .limit(1),
      db
        .select({
          total: sql<number>`coalesce(sum(${payments.creditMicros}), 0)`,
        })
        .from(payments)
        .where(
          sql`${payments.userId} = ${userId} and ${payments.status} = 'paid'`
        ),
      db
        .select({
          total: sql<number>`coalesce(sum(${usageRecords.priceMicros}), 0)`,
        })
        .from(usageRecords)
        .where(eq(usageRecords.userId, userId)),
    ])

  return {
    balanceMicros,
    totalToppedUpMicros: Number(topupAgg[0]?.total ?? 0),
    totalSpentMicros: Number(spendAgg[0]?.total ?? 0),
    payments: paymentRows.map((p) => ({
      id: p.id,
      type: p.type,
      packId: p.packId,
      priceLabel: p.priceLabel,
      creditMicros: Number(p.creditMicros),
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
    usage: usageRows.map((u) => ({
      id: u.id,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      priceMicros: Number(u.priceMicros),
      createdAt: u.createdAt.toISOString(),
    })),
    subscription: subRows[0]
      ? {
          subscriptionId: subRows[0].subscriptionId,
          productId: subRows[0].productId,
          status: subRows[0].status,
          currentPeriodEnd: subRows[0].currentPeriodEnd?.toISOString() ?? null,
        }
      : null,
  }
}
