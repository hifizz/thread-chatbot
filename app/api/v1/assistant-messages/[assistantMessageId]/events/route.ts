import { assistantEvents } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export const maxDuration = 300

export async function GET(
  request: Request,
  context: { params: Promise<{ assistantMessageId: string }> }
) {
  const { assistantMessageId } = await context.params
  return withActor(
    (actorId) => assistantEvents(actorId, assistantMessageId, request),
    "assistant_message_not_found"
  )
}
