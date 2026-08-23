import {
  assertCanonicalMutationAllowed,
  authenticatedActor,
  commandEnvelope,
  queryResponse,
  withConversationRoute,
} from "@/lib/thread-chat/http/conversation-command-http"
import { getConversationCommandComposition } from "@/lib/thread-chat/http/conversation-command-composition"
import {
  canonicalBootstrapConversationIds,
  ensureCanonicalPersonalProject,
} from "@/lib/thread-chat/persistence/canonical-conversation-bootstrap"

/** 返回最近的 active Conversation；首次进入时经规范 command API 创建。 */
export async function POST(request: Request) {
  return withConversationRoute(async () => {
    assertCanonicalMutationAllowed()
    const actor = await authenticatedActor()
    const project = await ensureCanonicalPersonalProject(actor.userId)
    const service = getConversationCommandComposition().service
    const existing = await service.listConversations({
      actorUserId: actor.userId,
      projectId: project,
    })
    const recent = existing.at(-1)
    if (recent)
      return queryResponse({
        conversationId: recent.id,
        created: false,
      })

    const ids = canonicalBootstrapConversationIds(actor.userId)
    try {
      await service.createConversation(
        commandEnvelope({
          request,
          actor,
          scope: { type: "project", id: project },
          payload: {
            ...ids,
            title: null,
            modelId: "glm-5.3",
          },
        })
      )
    } catch (cause) {
      // 两个首次请求可同时观察到空列表；唯一键让其中一个获胜，另一个只接受
      // 已经可读的同一 Conversation，不能吞掉其他创建错误。
      const raced = await service.listConversations({
        actorUserId: actor.userId,
        projectId: project,
      })
      if (!raced.some((item) => item.id === ids.conversationId)) throw cause
    }
    return queryResponse({
      conversationId: ids.conversationId,
      created: true,
    })
  })
}
