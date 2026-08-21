import { generationId } from "@/lib/thread-chat/domain/conversation-model"
import {
  abortCanonicalGenerationLocally,
  getConversationCommandComposition,
} from "@/lib/thread-chat/http/conversation-command-composition"
import {
  authenticatedActor,
  queryResponse,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"
import { ConversationCommandError } from "@/lib/thread-chat/application/conversation-command-contracts"

type Context = { params: Promise<{ generationId: string }> }

export async function POST(_request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = generationId((await params).generationId)
    const generation =
      await getConversationCommandComposition().service.stopGeneration({
        actorUserId: actor.userId,
        generationId: id,
        notifyLocalAbort: abortCanonicalGenerationLocally,
      })
    if (!generation)
      throw new ConversationCommandError("not_found", "Generation 不存在")
    return queryResponse({ generation })
  })
}
