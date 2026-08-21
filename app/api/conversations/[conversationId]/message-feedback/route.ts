import { canonicalMessageFeedbackListSchema } from "@/lib/thread-chat/contracts/conversation-message-feedback"
import { conversationId } from "@/lib/thread-chat/domain/conversation-model"
import {
  authenticatedActor,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"
import { listCanonicalMessageFeedback } from "@/lib/thread-chat/persistence/canonical-message-feedback-repository"

type Context = { params: Promise<{ conversationId: string }> }
export async function GET(_request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const targetConversationId = conversationId((await params).conversationId)
    const feedback = await listCanonicalMessageFeedback({
      userId: actor.userId,
      conversationId: targetConversationId,
    })
    return Response.json(canonicalMessageFeedbackListSchema.parse({ feedback }))
  })
}
