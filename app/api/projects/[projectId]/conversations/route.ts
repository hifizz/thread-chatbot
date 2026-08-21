import { createConversationRequestSchema } from "@/lib/thread-chat/contracts/conversation-command-api"
import {
  authenticatedActor,
  commandEnvelope,
  commandResponse,
  parseJson,
  queryResponse,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"
import { getConversationCommandComposition } from "@/lib/thread-chat/http/conversation-command-composition"
import {
  conversationId,
  projectId,
  threadId,
} from "@/lib/thread-chat/domain/conversation-model"

type Context = { params: Promise<{ projectId: string }> }

export async function GET(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const targetProjectId = projectId((await params).projectId)
    const includeArchived =
      new URL(request.url).searchParams.get("includeArchived") === "true"
    const items =
      await getConversationCommandComposition().service.listConversations({
        actorUserId: actor.userId,
        projectId: targetProjectId,
        includeArchived,
      })
    return queryResponse({ conversations: items })
  })
}

export async function POST(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const targetProjectId = projectId((await params).projectId)
    const body = await parseJson(request, createConversationRequestSchema)
    const result =
      await getConversationCommandComposition().service.createConversation(
        commandEnvelope({
          request,
          actor,
          scope: { type: "project", id: targetProjectId },
          payload: {
            conversationId: conversationId(body.conversationId),
            rootThreadId: threadId(body.rootThreadId),
            title: body.title,
            modelId: body.modelId,
          },
        })
      )
    return commandResponse(result, body.conversationId)
  })
}
