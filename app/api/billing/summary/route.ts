import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { externalUsageRecords, usageRecords } from "@/lib/db/schema"
import { getCurrentUserId } from "@/lib/auth/server"
import { ensureUserCredits, getBalanceMicros } from "@/lib/billing/credits"

// 输入框下方 token 统计的数据源：余额 + （可选）当前对话累计用量。
export async function GET(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 })

  // 兼容 hook 之前注册的老用户：首次拉取时补发初始额度。
  await ensureUserCredits(userId)
  const balanceMicros = await getBalanceMicros(userId)

  const threadId = new URL(req.url).searchParams.get("threadId")

  let thread: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    modelPriceMicros: number
    externalPriceMicros: number
    externalCallCount: number
    externalBillableUnits: number
    priceMicros: number
  } | null = null

  if (threadId) {
    const [[modelAgg], [externalAgg]] = await Promise.all([
      db
        .select({
          inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)`,
          priceMicros: sql<number>`coalesce(sum(${usageRecords.priceMicros}), 0)`,
        })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.userId, userId),
            eq(usageRecords.threadId, threadId)
          )
        ),
      db
        .select({
          callCount: sql<number>`count(*)`,
          billableUnits: sql<number>`coalesce(sum(${externalUsageRecords.billableUnits}), 0)`,
          priceMicros: sql<number>`coalesce(sum(${externalUsageRecords.userPriceMicros}), 0)`,
        })
        .from(externalUsageRecords)
        .where(
          and(
            eq(externalUsageRecords.userId, userId),
            eq(externalUsageRecords.threadId, threadId)
          )
        ),
    ])

    const inputTokens = Number(modelAgg?.inputTokens ?? 0)
    const outputTokens = Number(modelAgg?.outputTokens ?? 0)
    const modelPriceMicros = Number(modelAgg?.priceMicros ?? 0)
    const externalPriceMicros = Number(externalAgg?.priceMicros ?? 0)
    thread = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      modelPriceMicros,
      externalPriceMicros,
      externalCallCount: Number(externalAgg?.callCount ?? 0),
      externalBillableUnits: Number(externalAgg?.billableUnits ?? 0),
      priceMicros: modelPriceMicros + externalPriceMicros,
    }
  }

  // 最近一次调用（用于展示「本次」token 与费用）。有 threadId 时限定该对话。
  const [lastRow] = await db
    .select({
      model: usageRecords.model,
      messageId: usageRecords.messageId,
      inputTokens: usageRecords.inputTokens,
      outputTokens: usageRecords.outputTokens,
      priceMicros: usageRecords.priceMicros,
    })
    .from(usageRecords)
    .where(
      threadId
        ? and(
            eq(usageRecords.userId, userId),
            eq(usageRecords.threadId, threadId)
          )
        : eq(usageRecords.userId, userId)
    )
    .orderBy(desc(usageRecords.createdAt))
    .limit(1)

  const [lastExternal] = lastRow?.messageId
    ? await db
        .select({
          callCount: sql<number>`count(*)`,
          billableUnits: sql<number>`coalesce(sum(${externalUsageRecords.billableUnits}), 0)`,
          priceMicros: sql<number>`coalesce(sum(${externalUsageRecords.userPriceMicros}), 0)`,
        })
        .from(externalUsageRecords)
        .where(
          and(
            eq(externalUsageRecords.userId, userId),
            eq(externalUsageRecords.responseId, lastRow.messageId)
          )
        )
    : []

  const last = lastRow
    ? (() => {
        const modelPriceMicros = Number(lastRow.priceMicros)
        const externalPriceMicros = Number(lastExternal?.priceMicros ?? 0)
        return {
          model: lastRow.model,
          inputTokens: lastRow.inputTokens,
          outputTokens: lastRow.outputTokens,
          totalTokens: lastRow.inputTokens + lastRow.outputTokens,
          modelPriceMicros,
          externalPriceMicros,
          externalCallCount: Number(lastExternal?.callCount ?? 0),
          externalBillableUnits: Number(lastExternal?.billableUnits ?? 0),
          priceMicros: modelPriceMicros + externalPriceMicros,
        }
      })()
    : null

  return Response.json({ balanceMicros, thread, last })
}
