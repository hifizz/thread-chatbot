import { threadId } from "@/lib/thread-chat/domain/conversation-model"
import { getConversationCommandComposition } from "@/lib/thread-chat/http/conversation-command-composition"
import {
  authenticatedActor,
  commandEnvelope,
  commandResponse,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"

type Context = { params: Promise<{ threadId: string }> }

export async function POST(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = threadId((await params).threadId)
    const result =
      await getConversationCommandComposition().service.setThreadLifecycle(
        commandEnvelope({
          request,
          actor,
          scope: { type: "thread", id },
          payload: { lifecycle: "active" },
          expectedRevisionRequired: true,
        })
      )
    return commandResponse(result, id)
  })
}
