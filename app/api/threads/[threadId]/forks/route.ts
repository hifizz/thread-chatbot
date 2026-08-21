import { forkThreadRequestSchema } from "@/lib/thread-chat/contracts/conversation-command-api"
import {
  conversationId,
  messageId,
  threadForkId,
  threadId,
} from "@/lib/thread-chat/domain/conversation-model"
import { getConversationCommandComposition } from "@/lib/thread-chat/http/conversation-command-composition"
import {
  authenticatedActor,
  commandEnvelope,
  commandResponse,
  parseJson,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"

type Context = { params: Promise<{ threadId: string }> }

export async function POST(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = threadId((await params).threadId)
    const body = await parseJson(request, forkThreadRequestSchema)
    const result = await getConversationCommandComposition().service.forkThread(
      commandEnvelope({
        request,
        actor,
        scope: { type: "thread", id },
        expectedRevisionRequired: true,
        payload: {
          conversationId: conversationId(body.conversationId),
          forkId: threadForkId(body.forkId),
          childThreadId: threadId(body.childThreadId),
          sourceMessageId: messageId(body.sourceMessageId),
          modelId: body.modelId,
          localTitle: body.localTitle,
          anchor: body.anchor,
        },
      })
    )
    return commandResponse(result, body.conversationId)
  })
}
