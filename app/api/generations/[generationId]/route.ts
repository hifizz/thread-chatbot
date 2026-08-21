import { generationId } from "@/lib/thread-chat/domain/conversation-model"
import { getConversationCommandComposition } from "@/lib/thread-chat/http/conversation-command-composition"
import {
  authenticatedActor,
  queryResponse,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"
import { CONVERSATION_POLL_AFTER_MS } from "@/constants/conversation-command"
import { ConversationCommandError } from "@/lib/thread-chat/application/conversation-command-contracts"

type Context = { params: Promise<{ generationId: string }> }

export async function GET(_request: Request, { params }: Context) {
  return withConversationRoute(async () => {
    const actor = await authenticatedActor()
    const id = generationId((await params).generationId)
    const generation =
      await getConversationCommandComposition().service.getGeneration({
        actorUserId: actor.userId,
        generationId: id,
      })
    if (!generation)
      throw new ConversationCommandError("not_found", "Generation 不存在")
    return queryResponse({
      generation,
      pollAfterMs: ["running", "stop_requested"].includes(generation.status)
        ? CONVERSATION_POLL_AFTER_MS
        : null,
    })
  })
}
