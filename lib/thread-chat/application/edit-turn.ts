import { and, inArray, isNull } from "drizzle-orm"
import { messages } from "@/lib/db/schema"
import type { EditLatestTurnCommand } from "@/lib/thread-chat/contracts/commands"
import type { GenerationAcceptedDTO } from "@/lib/thread-chat/contracts/dto"
import { latestTurn } from "@/lib/thread-chat/domain/timeline"
import {
  assertAllowedModel,
  assertOwnedReadyAttachments,
  buildUserParts,
  commandFiles,
  touchProjectAndThread,
} from "@/lib/thread-chat/application/command-utils"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import {
  assertEditQuoteSemantics,
  assertValidQuoteSources,
} from "@/lib/thread-chat/application/quote-validation"
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

export interface EditTurnResult {
  generation: GenerationAcceptedDTO
  abortMessageId: string | null
}

export function editLatestTurn(
  userId: string,
  messageId: string,
  command: EditLatestTurnCommand
) {
  assertAllowedModel(command.modelId)
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "edit",
      scopeId: messageId,
      payload: command,
      execute: async (): Promise<EditTurnResult> => {
        const source = await lockOwnedMessage(tx, userId, messageId)
        if (!source) notFound()
        if (source.role !== "user") stateConflict("只能编辑用户消息")
        const thread = await lockOwnedThread(tx, userId, source.threadId)
        if (!thread) notFound()
        const project = await lockOwnedProject(tx, userId, source.projectId)
        if (!project) notFound()
        const timeline = await listThreadMessageRows(
          tx,
          source.projectId,
          source.threadId
        )
        const turn = latestTurn(timeline.map(toConversationMessage))
        if (turn?.userMessage.id !== source.id) {
          stateConflict("只能编辑最新一轮用户消息")
        }
        await assertOwnedReadyAttachments(tx, userId, commandFiles(command))
        assertEditQuoteSemantics(source.parts, command)
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
        const oldIds = [source.id, turn.assistantMessage?.id].filter(
          (id): id is string => Boolean(id)
        )
        const superseded = await tx
          .update(messages)
          .set({ supersededAt: now, updatedAt: now })
          .where(
            and(inArray(messages.id, oldIds), isNull(messages.supersededAt))
          )
          .returning({ id: messages.id })
        if (superseded.length !== oldIds.length) {
          stateConflict("当前轮次已被其他请求修改")
        }
        const [userMessage, assistantMessage] = await tx
          .insert(messages)
          .values([
            {
              id: command.userMessageId,
              projectId: source.projectId,
              threadId: source.threadId,
              sequence: userSequence,
              role: "user",
              parts: buildUserParts(command),
              status: "completed",
              replacesMessageId: source.id,
              finishedAt: now,
            },
            {
              id: command.assistantMessageId,
              projectId: source.projectId,
              threadId: source.threadId,
              sequence: assistantSequence,
              role: "assistant",
              parts: [],
              status: "generating",
              modelId: command.modelId,
              replacesMessageId: turn.assistantMessage?.id ?? null,
              startedAt: now,
            },
          ])
          .returning()
        await touchProjectAndThread(tx, project.id, thread.id, command.modelId)
        const rootThreadId = await findRootThreadId(tx, project.id)
        if (!rootThreadId) stateConflict("Project 缺少根 Thread")
        return {
          generation: {
            project: toProjectDTO(project, rootThreadId),
            thread: toThreadDTO({ ...thread, modelId: command.modelId }),
            userMessage: toMessageDTO(userMessage),
            assistantMessage: toMessageDTO(assistantMessage),
            streamUrl: `/api/thread-chat/v1/messages/${assistantMessage.id}/stream`,
          },
          abortMessageId:
            turn.assistantMessage?.status === "generating"
              ? turn.assistantMessage.id
              : null,
        }
      },
    })
  )
}
