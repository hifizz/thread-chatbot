import { editTurnInputRequestSchema } from "@/lib/thread-chat/contracts/conversation-command-api"
import {
  conversationId,
  generationId,
  messageId,
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

type Context = { params: Promise<{ turnId: string }> }

export async function POST(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = turnId((await params).turnId)
    const body = await parseJson(request, editTurnInputRequestSchema)
    const result =
      await getConversationCommandComposition().service.editTurnInput(
        commandEnvelope({
          request,
          actor,
          scope: { type: "turn", id },
          expectedRevisionRequired: true,
          payload: {
            conversationId: conversationId(body.conversationId),
            userMessageId: messageId(body.userMessageId),
            assistantMessageId: messageId(body.assistantMessageId),
            generationId: generationId(body.generationId),
            sourceUserMessageId: messageId(body.sourceUserMessageId),
            content: body.content as MessageContent,
            modelId: body.modelId,
          },
        })
      )
    return commandResponse(result, id)
  })
}
