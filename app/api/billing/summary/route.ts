import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { usageRecords } from "@/lib/db/schema"
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
    priceMicros: number
  } | null = null

  if (threadId) {
    const [agg] = await db
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
      )

    const inputTokens = Number(agg?.inputTokens ?? 0)
    const outputTokens = Number(agg?.outputTokens ?? 0)
    thread = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      priceMicros: Number(agg?.priceMicros ?? 0),
    }
  }

  // 最近一次调用（用于展示「本次」token 与费用）。有 threadId 时限定该对话。
  const [lastRow] = await db
    .select({
      model: usageRecords.model,
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

  const last = lastRow
    ? {
        model: lastRow.model,
        inputTokens: lastRow.inputTokens,
        outputTokens: lastRow.outputTokens,
        totalTokens: lastRow.inputTokens + lastRow.outputTokens,
        priceMicros: Number(lastRow.priceMicros),
      }
    : null

  return Response.json({ balanceMicros, thread, last })
}
