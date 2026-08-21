import { threadPatchRequestSchema } from "@/lib/thread-chat/contracts/conversation-command-api"
import { threadId } from "@/lib/thread-chat/domain/conversation-model"
import { getConversationCommandComposition } from "@/lib/thread-chat/http/conversation-command-composition"
import {
  authenticatedActor,
  commandEnvelope,
  commandResponse,
  parseJson,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"

type Context = { params: Promise<{ threadId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = threadId((await params).threadId)
    const body = await parseJson(request, threadPatchRequestSchema)
    const service = getConversationCommandComposition().service
    const result =
      "title" in body
        ? await service.renameThread(
            commandEnvelope({
              request,
              actor,
              scope: { type: "thread", id },
              payload: body,
              expectedRevisionRequired: true,
            })
          )
        : await service.setThreadLifecycle(
            commandEnvelope({
              request,
              actor,
              scope: { type: "thread", id },
              payload: body,
              expectedRevisionRequired: true,
            })
          )
    return commandResponse(result, id)
  })
}
