import { and, eq, isNull } from "drizzle-orm"
import { messages } from "@/lib/db/schema"
import type { RetryMessageCommand } from "@/lib/thread-chat/contracts/commands"
import type { GenerationAcceptedDTO } from "@/lib/thread-chat/contracts/dto"
import { canRetryLatestAssistant } from "@/lib/thread-chat/domain/timeline"
import {
  assertAllowedModel,
  touchProjectAndThread,
} from "@/lib/thread-chat/application/command-utils"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import {
  toConversationMessage,
  toMessageDTO,
  toProjectDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import {
  listThreadMessageRows,
  lockOwnedMessage,
} from "@/lib/thread-chat/persistence/message-repository"
import {
  findRootThreadId,
  lockOwnedProject,
} from "@/lib/thread-chat/persistence/project-repository"
import { lockOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"
import {
  allocateThreadSequences,
  withConversationTransaction,
} from "@/lib/thread-chat/persistence/transaction"

export function retryMessage(
  userId: string,
  messageId: string,
  command: RetryMessageCommand
) {
  assertAllowedModel(command.modelId)
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "retry",
      scopeId: messageId,
      payload: command,
      execute: async (): Promise<GenerationAcceptedDTO> => {
        const source = await lockOwnedMessage(tx, userId, messageId)
        if (!source) notFound()
        const thread = await lockOwnedThread(tx, userId, source.threadId)
        if (!thread) notFound()
        const project = await lockOwnedProject(tx, userId, source.projectId)
        if (!project) notFound()
        const timeline = await listThreadMessageRows(
          tx,
          source.projectId,
          source.threadId
        )
        if (
          !canRetryLatestAssistant(
            timeline.map(toConversationMessage),
            source.id
          )
        ) {
          stateConflict("只能重新生成最新的终态助手回复")
        }
        const [sequence] = await allocateThreadSequences(tx, thread.id, 1)
        const now = new Date()
        const [replacement] = await tx
          .insert(messages)
          .values({
            id: command.assistantMessageId,
            projectId: source.projectId,
            threadId: source.threadId,
            sequence,
            role: "assistant",
            parts: [],
            status: "generating",
            modelId: command.modelId,
            replacesMessageId: source.id,
            startedAt: now,
          })
          .returning()
        const [superseded] = await tx
          .update(messages)
          .set({ supersededAt: now, updatedAt: now })
          .where(and(eq(messages.id, source.id), isNull(messages.supersededAt)))
          .returning({ id: messages.id })
        if (!superseded) stateConflict("回复已被其他请求取代")
        await touchProjectAndThread(tx, project.id, thread.id, command.modelId)
        const rootThreadId = await findRootThreadId(tx, project.id)
        if (!rootThreadId) stateConflict("Project 缺少根 Thread")
        return {
          project: toProjectDTO(project, rootThreadId),
          thread: toThreadDTO({ ...thread, modelId: command.modelId }),
          assistantMessage: toMessageDTO(replacement),
          streamUrl: `/api/thread-chat/v1/messages/${replacement.id}/stream`,
        }
      },
    })
  )
}
