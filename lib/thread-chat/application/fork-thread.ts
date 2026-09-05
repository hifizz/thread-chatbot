import { messages, threads } from "@/lib/db/schema"
import type { ForkThreadCommand } from "@/lib/thread-chat/contracts/commands"
import type {
  GenerationAcceptedDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import { buildFrozenForkContext } from "@/lib/thread-chat/domain/fork-context"
import {
  assertAllowedModel,
  assertOwnedReadyAttachments,
  buildUserParts,
  commandFiles,
  touchProjectAndThread,
} from "@/lib/thread-chat/application/command-utils"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import { assertValidQuoteSources } from "@/lib/thread-chat/application/quote-validation"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import {
  toConversationMessage,
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
  allocateProjectFootnote,
  allocateThreadSequences,
  withConversationTransaction,
} from "@/lib/thread-chat/persistence/transaction"

export type ForkThreadResult =
  | { thread: ThreadDTO; generation: null }
  | { thread: ThreadDTO; generation: GenerationAcceptedDTO }

export function forkThread(
  userId: string,
  parentThreadId: string,
  command: ForkThreadCommand
) {
  assertAllowedModel(command.modelId)
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "fork",
      scopeId: parentThreadId,
      payload: command,
      execute: async (): Promise<ForkThreadResult> => {
        const parent = await lockOwnedThread(tx, userId, parentThreadId)
        if (!parent) notFound()
        const project = await lockOwnedProject(tx, userId, parent.projectId)
        if (!project) notFound()
        if (project.archivedAt) stateConflict("已归档 Project 不可创建分支")
        const parentMessages = await listThreadMessageRows(
          tx,
          project.id,
          parent.id
        )
        const source = parentMessages.find(
          (message) => message.id === command.sourceMessageId
        )
        if (!source || source.supersededAt)
          stateConflict("分支来源不在当前时间线")
        if (command.anchor.quote.exact !== command.anchorText) {
          stateConflict("选区锚点与来源文本不一致")
        }
        const forkContext = buildFrozenForkContext({
          parentForkContext: parent.forkContext,
          parentMessages: parentMessages.map(toConversationMessage),
          sourceMessageId: source.id,
        })
        const footnote = await allocateProjectFootnote(tx, project.id)
        const [child] = await tx
          .insert(threads)
          .values({
            id: command.threadId,
            projectId: project.id,
            parentId: parent.id,
            forkMessageId: source.id,
            forkContext,
            forkAnchor: command.anchor,
            anchorText: command.anchorText,
            footnote,
            depth: parent.depth + 1,
            modelId: command.modelId,
          })
          .returning()
        if (!command.firstTurn) {
          await touchProjectAndThread(tx, project.id, child.id)
          return { thread: toThreadDTO(child), generation: null }
        }
        await assertOwnedReadyAttachments(
          tx,
          userId,
          commandFiles(command.firstTurn)
        )
        await assertValidQuoteSources({
          tx,
          projectId: project.id,
          sourceThreadId: parent.id,
          content: command.firstTurn,
        })
        const [userSequence, assistantSequence] = await allocateThreadSequences(
          tx,
          child.id,
          2
        )
        const now = new Date()
        const [userMessage, assistantMessage] = await tx
          .insert(messages)
          .values([
            {
              id: command.firstTurn.userMessageId,
              projectId: project.id,
              threadId: child.id,
              sequence: userSequence,
              role: "user",
              parts: buildUserParts(command.firstTurn),
              status: "completed",
              finishedAt: now,
            },
            {
              id: command.firstTurn.assistantMessageId,
              projectId: project.id,
              threadId: child.id,
              sequence: assistantSequence,
              role: "assistant",
              parts: [],
              status: "generating",
              modelId: command.modelId,
              startedAt: now,
            },
          ])
          .returning()
        await touchProjectAndThread(tx, project.id, child.id, command.modelId)
        const rootThreadId = await findRootThreadId(tx, project.id)
        if (!rootThreadId) stateConflict("Project 缺少根 Thread")
        return {
          thread: toThreadDTO(child),
          generation: {
            project: toProjectDTO(project, rootThreadId),
            thread: toThreadDTO(child),
            userMessage: toMessageDTO(userMessage),
            assistantMessage: toMessageDTO(assistantMessage),
            streamUrl: `/api/thread-chat/v1/messages/${assistantMessage.id}/stream`,
          },
        }
      },
    })
  )
}
