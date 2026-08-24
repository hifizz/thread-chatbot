import { sendTurnRequestSchema } from "@/lib/thread-chat/contracts/conversation-command-api"
import {
  conversationId,
  generationId,
  messageId,
  threadId,
  turnId,
} from "@/lib/thread-chat/domain/conversation-model"
import type { MessageContent } from "@/lib/thread-chat/domain/conversation-model"
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
    const body = await parseJson(request, sendTurnRequestSchema)
    const result = await getConversationCommandComposition().service.sendTurn(
      commandEnvelope({
        request,
        actor,
        scope: { type: "thread", id },
        expectedRevisionRequired: true,
        payload: {
          conversationId: conversationId(body.conversationId),
          turnId: turnId(body.turnId),
          userMessageId: messageId(body.userMessageId),
          assistantMessageId: messageId(body.assistantMessageId),
          generationId: generationId(body.generationId),
          content: body.content as MessageContent,
          modelId: body.modelId,
        },
      })
    )
    return commandResponse(result, id)
  })
}
