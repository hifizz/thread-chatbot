import { z } from "zod"
import { getCurrentUserId } from "@/lib/auth/server"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { setMessageFeedbackForOwner } from "@/lib/thread-chat-generation/message-feedback-repository"

type RouteContext = {
  params: Promise<{ treeId: string; messageId: string }>
}

const feedbackBodySchema = z.object({
  threadId: z.string().min(1),
  feedback: z.enum(["positive", "negative"]).nullable(),
})

export async function PUT(req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId)
    return Response.json(
      { error: { code: "unauthorized", message: "请先登录" } },
      { status: 401 }
    )

  const { treeId, messageId } = await params
  if (!isValidTreeId(treeId) || messageId.trim() === "")
    return Response.json(
      { error: { code: "invalid_id", message: "消息身份无效" } },
      { status: 400 }
    )

  const body = feedbackBodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success)
    return Response.json(
      {
        error: {
          code: "invalid_feedback",
          message: "threadId 与 feedback 必须有效",
        },
      },
      { status: 400 }
    )

  const result = await setMessageFeedbackForOwner({
    userId,
    treeId,
    threadId: body.data.threadId,
    messageId,
    feedback: body.data.feedback,
  })
  if (!result.ok) {
    if (result.reason === "not_found")
      return Response.json(
        { error: { code: "not_found", message: "消息不存在" } },
        { status: 404 }
      )
    return Response.json(
      {
        error: {
          code:
            result.reason === "not_completed"
              ? "message_not_completed"
              : "missing_generation_link",
          message:
            result.reason === "not_completed"
              ? "只有已完成的 AI 回复可以评价"
              : "已完成回复缺少生成记录",
        },
      },
      { status: 409 }
    )
  }

  return Response.json({ feedback: result.feedback })
}
