import { getCurrentUserId } from "@/lib/auth/server"
import { isValidTreeId } from "@/lib/chat/tree-id"
import {
  MESSAGE_FEEDBACK_HTTP_ERRORS,
  setMessageFeedbackErrorResponseSchema,
  setMessageFeedbackRequestSchema,
  setMessageFeedbackSuccessResponseSchema,
} from "@/lib/thread-chat/contracts/message-feedback"
import { setMessageFeedbackForOwner } from "@/lib/thread-chat-generation/message-feedback-repository"
import { legacyProtocolGate } from "@/lib/thread-chat/cutover/conversation-authority"

type RouteContext = {
  params: Promise<{ treeId: string; messageId: string }>
}

function feedbackErrorResponse(key: keyof typeof MESSAGE_FEEDBACK_HTTP_ERRORS) {
  const definition = MESSAGE_FEEDBACK_HTTP_ERRORS[key]
  return Response.json(
    setMessageFeedbackErrorResponseSchema.parse({ error: definition.error }),
    { status: definition.status }
  )
}

export async function PUT(req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return feedbackErrorResponse("unauthorized")

  const { treeId, messageId } = await params
  if (!isValidTreeId(treeId) || messageId.trim() === "")
    return feedbackErrorResponse("invalid_id")
  const gate = legacyProtocolGate({
    mutation: true,
    protocol: "branch-message-feedback",
  })
  if (gate) return gate

  const body = setMessageFeedbackRequestSchema.safeParse(
    await req.json().catch(() => null)
  )
  if (!body.success) return feedbackErrorResponse("invalid_feedback")

  const result = await setMessageFeedbackForOwner({
    userId,
    treeId,
    threadId: body.data.threadId,
    messageId,
    feedback: body.data.feedback,
  })
  if (!result.ok) return feedbackErrorResponse(result.reason)

  return Response.json(
    setMessageFeedbackSuccessResponseSchema.parse({
      feedback: result.feedback,
    })
  )
}
