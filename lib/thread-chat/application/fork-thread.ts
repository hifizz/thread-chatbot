import { appendDocumentNotices } from "./documents/notices"
import { resolveForkModelId } from "@/lib/thread-chat/application/fork-model"
import { resolveUserContent } from "./resolve-user-content"
import { messages, threads } from "@/lib/db/schema"
import type {
  ForkTarget,
  ForkThreadCommand,
} from "@/lib/thread-chat/contracts/commands"
import { THREAD_QUOTE_SCHEMA_VERSION } from "@/lib/thread-chat/contracts/quote"
import type {
  GenerationAcceptedDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import { buildFrozenForkContext } from "@/lib/thread-chat/domain/fork-context"
import { locateArtifactAnchor } from "@/lib/thread-chat/domain/markdown-visible-text"
import {
  assertAllowedGenerationSettings,
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
import { findOwnedArtifact } from "@/lib/thread-chat/persistence/artifact-repository"
import { listThreadMessageRows } from "@/lib/thread-chat/persistence/message-repository"
import {
  findRootThreadId,
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

function normalizedTarget(command: ForkThreadCommand): ForkTarget {
  if (command.target) return command.target
  if (!command.anchor || !command.anchorText) {
    stateConflict("分支来源缺少选区")
  }
  return { type: "message", anchor: command.anchor! }
}

export function forkThread(
  userId: string,
  parentThreadId: string,
  command: ForkThreadCommand
) {
  const modelId = resolveForkModelId(command.modelId) ?? command.modelId
  assertAllowedModel(modelId)
  assertAllowedGenerationSettings(modelId, command.generationSettings)
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "fork",
      scopeId: parentThreadId,
      payload: command,
      execute: async (): Promise<ForkThreadResult> => {
        const locked = await lockOwnedThread(tx, userId, parentThreadId)
        if (!locked) notFound()
        const { project, thread: parent } = locked
        if (project.archivedAt) stateConflict("已归档 Project 不可创建分支")
        if (parent.archivedAt) stateConflict("已归档 Thread 不可创建分支")
        const target = normalizedTarget(command)
        const anchor = target.anchor
        const anchorText = anchor.quote.exact
        if (command.anchorText && command.anchorText !== anchorText) {
          stateConflict("选区锚点与来源文本不一致")
        }
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
        if (source.role !== "assistant")
          stateConflict("只能从 Assistant 回复产生的内容创建分支")
        if (source.status !== "completed")
          stateConflict("分支来源尚未完成")

        let forkArtifactId: string | null = null
        if (target.type === "artifact") {
          const row = await findOwnedArtifact(tx, userId, target.artifactId)
          if (!row) notFound()
          const artifact = row.artifact
          if (
            artifact.projectId !== project.id ||
            artifact.threadId !== parent.id ||
            artifact.sourceMessageId !== source.id
          ) {
            stateConflict("Artifact 与分支来源不匹配")
          }
          if (artifact.kind !== "markdown")
            stateConflict("当前只支持从 Markdown Artifact 开启分支")
          if (row.sourceMessageStatus !== "completed")
            stateConflict("Artifact 来源尚未完成")
          if (!locateArtifactAnchor(artifact.content, anchor))
            stateConflict("选区无法在 Artifact 可见文字中唯一定位，请重新划选")
          forkArtifactId = artifact.id
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
            forkArtifactId,
            forkContext,
            forkAnchor: anchor,
            anchorText,
            footnote,
            depth: parent.depth + 1,
            modelId,
          })
          .returning()
        if (!command.firstTurn) {
          await touchProjectAndThread(tx, project.id, child.id)
          return { thread: toThreadDTO(child), generation: null }
        }
        const frozenFirstQuote = {
          schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
          text: anchorText,
          source:
            target.type === "artifact"
              ? {
                  type: "artifact" as const,
                  messageId: source.id,
                  artifactId: target.artifactId,
                  anchor,
                }
              : {
                  type: "message" as const,
                  messageId: source.id,
                  anchor,
                },
        }
        const parts = await resolveUserContent({
          tx,
          userId,
          projectId: project.id,
          modelId,
          content: command.firstTurn,
          operation: {
            type: "send",
            sourceThreadId: parent.id,
            frozenFirstQuote,
          },
        })
        await appendDocumentNotices(tx, project.id, child.id, parts)
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
              parts,
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
              modelId,
              startedAt: now,
            },
          ])
          .returning()
        await touchProjectAndThread(tx, project.id, child.id, modelId)
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
