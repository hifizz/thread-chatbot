import { patchThread } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function PATCH(
  request: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params
  return withActor(
    (actorId) => patchThread(actorId, threadId, request),
    "thread_not_found"
  )
}
