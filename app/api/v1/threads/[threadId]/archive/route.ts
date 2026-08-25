import { setThreadArchived } from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

export async function POST(
  _request: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params
  return withActor(
    (actorId) => setThreadArchived(actorId, threadId, true),
    "thread_not_found"
  )
}
