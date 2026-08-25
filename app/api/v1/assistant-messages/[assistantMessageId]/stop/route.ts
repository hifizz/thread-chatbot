import { stopAssistant } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function POST(
  _request: Request,
  context: { params: Promise<{ assistantMessageId: string }> }
) {
  const { assistantMessageId } = await context.params
  return withActor(
    (actorId) => stopAssistant(actorId, assistantMessageId),
    "assistant_message_not_found"
  )
}
