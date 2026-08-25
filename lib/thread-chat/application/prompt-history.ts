import { invariant } from "../domain/domain-error"
import type { Message } from "../domain/message"
import { buildPromptHistory } from "../domain/prompt-history"
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
  const assistantIds = [...baseMessages, ...currentMessages]
    .filter((message) => message.role === "assistant")
    .map((message) => message.id)
  const runs = await repositories.messageRuns.findOwnedByAssistantMessageIds(
    input.actorId,
    assistantIds
  )
  return buildPromptHistory({
    baseMessageIds: baseIds,
    baseMessages,
    currentMessages,
    assistantRuns: runs,
  })
}
