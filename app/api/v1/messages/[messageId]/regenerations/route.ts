import { regenerateMessage } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await context.params
  return withActor(
    (actorId) => regenerateMessage(actorId, messageId, request),
    "message_not_found"
  )
}
