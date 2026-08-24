import { selectTurnVariantRequestSchema } from "@/lib/thread-chat/contracts/conversation-command-api"
import {
  conversationId,
  messageId,
  turnId,
} from "@/lib/thread-chat/domain/conversation-model"
import { getConversationCommandComposition } from "@/lib/thread-chat/http/conversation-command-composition"
import {
  authenticatedActor,
  commandEnvelope,
  commandResponse,
  parseJson,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"

type Context = { params: Promise<{ turnId: string }> }

export async function POST(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = turnId((await params).turnId)
    const body = await parseJson(request, selectTurnVariantRequestSchema)
    const result =
      await getConversationCommandComposition().service.selectTurnVariant(
        commandEnvelope({
          request,
          actor,
          scope: { type: "turn", id },
          expectedRevisionRequired: true,
          payload: {
            conversationId: conversationId(body.conversationId),
            messageId: messageId(body.messageId),
            role: body.role,
          },
        })
      )
    return commandResponse(result, id)
  })
}
