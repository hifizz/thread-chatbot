import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { attachments } from "@/lib/db/schema"
import { generateInsights } from "@/lib/attachments/insights"
import { isMinimaxConfigured } from "@/lib/ai/minimax"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * 附件洞察：返回 PDF 的摘要 + 建议问题（冷启动引导）。
 * 首次调用时按需生成并缓存进 DB，后续直接返回缓存。
 */
export async function POST(_req: Request, { params }: RouteContext) {
  const { id } = await params
  const [row] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1)
  if (!row) return Response.json({ error: "附件不存在" }, { status: 404 })

  // 已有缓存直接返回
  if (row.summary || row.suggestedQuestions?.length) {
    return Response.json({
      summary: row.summary ?? "",
      suggestedQuestions: row.suggestedQuestions ?? [],
    })
  }

  // 仅对解析就绪的 PDF 生成
  if (
    row.mimeType !== "application/pdf" ||
    row.status !== "ready" ||
    !row.pages?.length
  ) {
    return Response.json({ summary: "", suggestedQuestions: [] })
  }
  if (!isMinimaxConfigured()) {
    return Response.json(
      { error: "未配置模型（MINIMAX_API_KEY）" },
      { status: 503 }
    )
  }

  const insights = await generateInsights(row.pages)
  if (!insights) {
    return Response.json({ summary: "", suggestedQuestions: [] })
  }

  await db
    .update(attachments)
    .set({
      summary: insights.summary,
      suggestedQuestions: insights.suggestedQuestions,
    })
    .where(eq(attachments.id, id))

  return Response.json(insights)
}
