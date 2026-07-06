import { z } from "zod"
import {
  getLangfuseClient,
  isLangfuseConfigured,
  isValidTraceId,
} from "@/lib/observability/langfuse"
import { USER_FEEDBACK_SCORE_NAME } from "@/constants/observability"

// 用户对 assistant 消息的点赞/点踩，作为 score 回写到 Langfuse 对应 trace。
// assistant 消息 id 由 chat route 下发，值即该轮对话的 traceId（见 chat/route.ts）。

const bodySchema = z.object({
  messageId: z.string(),
  type: z.enum(["positive", "negative"]),
  comment: z.string().max(500).optional(),
})

export async function POST(req: Request) {
  // 未启用遥测：静默接受，反馈不落任何地方（前端无需感知配置状态）
  if (!isLangfuseConfigured()) return new Response(null, { status: 204 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return new Response("Bad request", { status: 400 })
  const { messageId, type, comment } = parsed.data

  // 只有 traceId 格式的消息 id 才可回写；历史消息或遥测未启用期间生成的消息直接忽略
  if (!isValidTraceId(messageId)) return new Response(null, { status: 204 })

  const langfuse = getLangfuseClient()
  langfuse.score.create({
    // 幂等 id：同一条消息改票时覆盖同一个 score，不产生重复计数
    id: `${USER_FEEDBACK_SCORE_NAME}-${messageId}`,
    traceId: messageId,
    name: USER_FEEDBACK_SCORE_NAME,
    value: type === "positive" ? 1 : 0,
    dataType: "BOOLEAN",
    ...(comment && { comment }),
  })
  // route handler 生命周期短，立即冲刷而不是等批量间隔
  await langfuse.score.flush()

  return new Response(null, { status: 204 })
}
