import { ConversationCommandError } from "@/lib/thread-chat/application/conversation-command-contracts"
import {
  setCanonicalMessageFeedbackRequestSchema,
  setCanonicalMessageFeedbackResponseSchema,
} from "@/lib/thread-chat/contracts/conversation-message-feedback"
import {
  conversationId,
  messageId,
  threadId,
} from "@/lib/thread-chat/domain/conversation-model"
import {
  authenticatedActor,
  parseJson,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"
import { setCanonicalMessageFeedback } from "@/lib/thread-chat/persistence/canonical-message-feedback-repository"

type Context = {
  params: Promise<{ conversationId: string; messageId: string }>
}
export async function PUT(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const ids = await params
    const body = await parseJson(
      request,
      setCanonicalMessageFeedbackRequestSchema
    )
    const result = await setCanonicalMessageFeedback({
      userId: actor.userId,
      conversationId: conversationId(ids.conversationId),
      threadId: threadId(body.threadId),
      messageId: messageId(ids.messageId),
      feedback: body.feedback,
    })
    if (!result.ok) {
      const message = {
        not_found: "消息不存在",
        not_completed: "只有已完成的 AI 回复可以评价",
        missing_generation: "已完成回复缺少 completed Generation",
      }[result.reason]
      throw new ConversationCommandError(
        result.reason === "not_found" ? "not_found" : "state_conflict",
        message
      )
    }
    return Response.json(
      setCanonicalMessageFeedbackResponseSchema.parse(result)
    )
  })
}
