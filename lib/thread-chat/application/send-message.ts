import { messages } from "@/lib/db/schema"
import type { SendMessageCommand } from "@/lib/thread-chat/contracts/commands"
import type { GenerationAcceptedDTO } from "@/lib/thread-chat/contracts/dto"
import {
  assertAllowedModel,
  assertOwnedReadyAttachments,
  assertThreadReadyForTurn,
  buildUserParts,
  touchProjectAndThread,
} from "@/lib/thread-chat/application/command-utils"
import {
  buildBranchOriginQuote,
  mergeBranchOriginQuote,
  resolveQuoteSelections,
} from "@/lib/thread-chat/application/quote-resolver"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import {
  toMessageDTO,
  toProjectDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import { listThreadMessageRows } from "@/lib/thread-chat/persistence/message-repository"
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
        await assertOwnedReadyAttachments(tx, userId, command.files)

        const selections = await resolveQuoteSelections({
          tx,
          destinationProjectId: project.id,
          destinationThreadId: thread.id,
          selections: command.quotes ?? [],
        })
        const timeline = await listThreadMessageRows(tx, project.id, thread.id)
        const hasActiveUserMessage = timeline.some(
          (row) => row.role === "user" && row.supersededAt === null
        )
        const origin =
          !hasActiveUserMessage &&
          thread.parentId &&
          thread.forkMessageId &&
          thread.forkAnchor &&
          thread.anchorText
            ? buildBranchOriginQuote({
                projectId: project.id,
                parentThreadId: thread.parentId,
                sourceMessageId: thread.forkMessageId,
                anchor: thread.forkAnchor,
                anchorText: thread.anchorText,
              })
            : null
        const quotes = origin
          ? mergeBranchOriginQuote(origin, selections)
          : selections

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
              parts: buildUserParts({
                text: command.text,
                files: command.files,
                quotes,
              }),
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
