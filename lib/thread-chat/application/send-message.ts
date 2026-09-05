import { messages } from "@/lib/db/schema"
import type { SendMessageCommand } from "@/lib/thread-chat/contracts/commands"
import type { GenerationAcceptedDTO } from "@/lib/thread-chat/contracts/dto"
import {
  assertAllowedGenerationSettings,
  assertAllowedModel,
  assertOwnedReadyAttachments,
  assertModelSupportsNewAttachments,
  assertThreadReadyForTurn,
  buildUserParts,
  commandFiles,
  touchProjectAndThread,
} from "@/lib/thread-chat/application/command-utils"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import { assertValidQuoteSources } from "@/lib/thread-chat/application/quote-validation"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import {
  toMessageDTO,
  toProjectDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import {
  findRootThreadId,
  lockOwnedProject,
} from "@/lib/thread-chat/persistence/project-repository"
import { lockOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"
import {
  allocateThreadSequences,
  withConversationTransaction,
} from "@/lib/thread-chat/persistence/transaction"

export function sendMessage(
  userId: string,
  threadId: string,
  command: SendMessageCommand
) {
  assertAllowedModel(command.modelId)
  assertAllowedGenerationSettings(command.modelId, command.generationSettings)
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "send",
      scopeId: threadId,
      payload: command,
      execute: async (): Promise<GenerationAcceptedDTO> => {
        const thread = await lockOwnedThread(tx, userId, threadId)
        if (!thread) notFound()
        const project = await lockOwnedProject(tx, userId, thread.projectId)
        if (!project) notFound()
        if (project.archivedAt) stateConflict("已归档 Project 不可发送消息")
        await assertThreadReadyForTurn(tx, project.id, thread.id)
        const files = commandFiles(command)
        assertModelSupportsNewAttachments(command.modelId, files)
        await assertOwnedReadyAttachments(tx, userId, files)
        await assertValidQuoteSources({
          tx,
          projectId: project.id,
          sourceThreadId: thread.id,
          content: command,
        })
        const [userSequence, assistantSequence] = await allocateThreadSequences(
          tx,
          thread.id,
          2
        )
        const now = new Date()
        const [userMessage, assistantMessage] = await tx
          .insert(messages)
          .values([
            {
              id: command.userMessageId,
              projectId: project.id,
              threadId: thread.id,
              sequence: userSequence,
              role: "user",
              parts: buildUserParts(command),
              status: "completed",
              finishedAt: now,
            },
            {
              id: command.assistantMessageId,
              projectId: project.id,
              threadId: thread.id,
              sequence: assistantSequence,
              role: "assistant",
              parts: [],
              status: "generating",
              modelId: command.modelId,
              startedAt: now,
            },
          ])
          .returning()
        await touchProjectAndThread(tx, project.id, thread.id, command.modelId)
        const rootThreadId = await findRootThreadId(tx, project.id)
        if (!rootThreadId) stateConflict("Project 缺少根 Thread")
        return {
          project: toProjectDTO(project, rootThreadId),
          thread: toThreadDTO({ ...thread, modelId: command.modelId }),
          userMessage: toMessageDTO(userMessage),
          assistantMessage: toMessageDTO(assistantMessage),
          streamUrl: `/api/thread-chat/v1/messages/${assistantMessage.id}/stream`,
        }
      },
    })
  )
}
