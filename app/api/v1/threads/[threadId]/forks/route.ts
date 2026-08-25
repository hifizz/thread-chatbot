import { forkThread } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params
  return withActor(
    (actorId) => forkThread(actorId, threadId, request),
    "thread_not_found"
  )
}
