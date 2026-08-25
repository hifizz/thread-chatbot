import {
  loadThreadMessages,
  sendMessage,
} from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"

type Context = { params: Promise<{ threadId: string }> }

export async function GET(request: Request, context: Context) {
  const { threadId } = await context.params
  return withActor(
    (actorId) => loadThreadMessages(actorId, threadId, request),
    "thread_not_found"
  )
}

export async function POST(request: Request, context: Context) {
  const { threadId } = await context.params
  return withActor(
    (actorId) => sendMessage(actorId, threadId, request),
    "thread_not_found"
  )
}
