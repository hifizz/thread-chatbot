import { invariant } from "../domain/domain-error"
import type { Message } from "../domain/message"
import {
  createThreadChatRepositories,
  type ThreadChatSql,
} from "../infrastructure/repositories"

export async function loadPromptHistory(
  sql: ThreadChatSql,
  input: { actorId: string; threadId: string }
): Promise<Message[]> {
  const repositories = createThreadChatRepositories(sql)
  const thread = await repositories.threads.findOwnedById(
    input.actorId,
    input.threadId
  )
  invariant(thread, "entity_not_found", "Thread 不存在。")
  const baseIds = thread.baseContext?.messageIds ?? []
  const [baseMessages, currentMessages] = await Promise.all([
    repositories.messages.listByIdsOwned(input.actorId, baseIds),
    repositories.messages.listEffectiveOwned(input.actorId, thread.id, 100_000),
  ])
  const byId = new Map(baseMessages.map((message) => [message.id, message]))
  const orderedBase = baseIds.map((messageId) => {
    const message = byId.get(messageId)
    invariant(
      message,
      "base_context_message_missing",
      `BaseContext 引用的 Message ${messageId} 不存在。`
    )
    return message
  })
  const candidates = [...orderedBase, ...currentMessages]
  const assistantIds = candidates
    .filter((message) => message.role === "assistant")
    .map((message) => message.id)
  const runs = await repositories.messageRuns.findOwnedByAssistantMessageIds(
    input.actorId,
    assistantIds
  )
  const completedAssistantIds = new Set(
    runs
      .filter((run) => run.status === "completed")
      .map((run) => run.assistantMessageId)
  )
  const seen = new Set<string>()
  return candidates.filter((message) => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    if (message.finalizedAt === null) return false
    return (
      message.role === "user" || completedAssistantIds.has(message.id)
    )
  })
}
