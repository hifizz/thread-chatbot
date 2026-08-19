import { z } from "zod"
import { getCurrentUserId } from "@/lib/auth/server"
import { isValidTreeId } from "@/lib/chat/tree-id"
import {
  setGenerationFeedbackForOwner,
  toGenerationSummary,
} from "@/lib/thread-chat-generation/repository"

type RouteContext = { params: Promise<{ generationId: string }> }

const feedbackBodySchema = z.object({
  feedback: z.enum(["positive", "negative"]).nullable(),
})

export async function PUT(req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId)
    return Response.json(
      { error: { code: "unauthorized", message: "请先登录" } },
      { status: 401 }
    )

  const { generationId } = await params
  if (!isValidTreeId(generationId))
    return Response.json(
      { error: { code: "invalid_id", message: "generationId 必须是 UUID" } },
      { status: 400 }
    )

  const body = feedbackBodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success)
    return Response.json(
      {
        error: {
          code: "invalid_feedback",
          message: "feedback 必须是 positive、negative 或 null",
        },
      },
      { status: 400 }
    )

  const generation = await setGenerationFeedbackForOwner({
    userId,
    generationId,
    feedback: body.data.feedback,
  })
  if (!generation)
    return Response.json(
      { error: { code: "not_found", message: "generation 不存在" } },
      { status: 404 }
    )

  return Response.json({ generation: toGenerationSummary(generation) })
}
