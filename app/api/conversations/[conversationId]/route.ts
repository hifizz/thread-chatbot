import { conversationPatchRequestSchema } from "@/lib/thread-chat/contracts/conversation-command-api"
import { ConversationCommandError } from "@/lib/thread-chat/application/conversation-command-contracts"
import { conversationId } from "@/lib/thread-chat/domain/conversation-model"
import { getConversationCommandComposition } from "@/lib/thread-chat/http/conversation-command-composition"
import {
  authenticatedActor,
  commandEnvelope,
  commandResponse,
  parseJson,
  queryResponse,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"

type Context = { params: Promise<{ conversationId: string }> }

export async function GET(_request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = conversationId((await params).conversationId)
    const result =
      await getConversationCommandComposition().service.getConversationSnapshot(
        {
          actorUserId: actor.userId,
          conversationId: id,
        }
      )
    if (!result)
      throw new ConversationCommandError("not_found", "Conversation 不存在")
    return queryResponse(result, result.snapshot.conversation.revision)
  })
}

export async function PATCH(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = conversationId((await params).conversationId)
    const body = await parseJson(request, conversationPatchRequestSchema)
    const service = getConversationCommandComposition().service
    const result =
      "title" in body
        ? await service.renameConversation(
            commandEnvelope({
              request,
              actor,
              scope: { type: "conversation", id },
              payload: body,
              expectedRevisionRequired: true,
            })
          )
        : await service.setConversationLifecycle(
            commandEnvelope({
              request,
              actor,
              scope: { type: "conversation", id },
              payload: body,
              expectedRevisionRequired: true,
            })
          )
    return commandResponse(result, id)
  })
}

export async function DELETE(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = conversationId((await params).conversationId)
    const result =
      await getConversationCommandComposition().service.deleteConversation(
        commandEnvelope({
          request,
          actor,
          scope: { type: "conversation", id },
          payload: {},
          expectedRevisionRequired: true,
        })
      )
    return commandResponse(result, id)
  })
}
