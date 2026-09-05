import { eq } from "drizzle-orm"
import { messages, projects, threads } from "@/lib/db/schema"
import type { StartProjectCommand } from "@/lib/thread-chat/contracts/commands"
import type { GenerationAcceptedDTO } from "@/lib/thread-chat/contracts/dto"
import {
  assertAllowedGenerationSettings,
  assertAllowedModel,
  assertOwnedReadyAttachments,
  assertModelSupportsNewAttachments,
  buildUserParts,
  commandFiles,
} from "@/lib/thread-chat/application/command-utils"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import {
  toMessageDTO,
  toProjectDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import {
  allocateThreadSequences,
  withConversationTransaction,
} from "@/lib/thread-chat/persistence/transaction"

export function startProject(userId: string, command: StartProjectCommand) {
  assertAllowedModel(command.modelId)
  assertAllowedGenerationSettings(command.modelId, command.generationSettings)
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "start",
      scopeId: command.projectId,
      payload: command,
      execute: async (): Promise<GenerationAcceptedDTO> => {
        const [existing] = await tx
          .select({ userId: projects.userId })
          .from(projects)
          .where(eq(projects.id, command.projectId))
          .limit(1)
        if (existing) {
          if (existing.userId !== userId) notFound()
          stateConflict("Project 已存在")
        }
        const files = commandFiles(command)
        assertModelSupportsNewAttachments(command.modelId, files)
        await assertOwnedReadyAttachments(tx, userId, files)
        if (command.parts.some((part) => part.type === "quote")) {
          stateConflict("新建 Project 时不能引用尚不属于该 Project 的内容")
        }
        const now = new Date()
        const [project] = await tx
          .insert(projects)
          .values({ id: command.projectId, userId })
          .returning()
        const [thread] = await tx
          .insert(threads)
          .values({
            id: command.rootThreadId,
            projectId: project.id,
            depth: 0,
            modelId: command.modelId,
          })
          .returning()
        const [userSequence, assistantSequence] = await allocateThreadSequences(
          tx,
          thread.id,
          2
        )
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
        return {
          project: toProjectDTO(project, thread.id),
          thread: toThreadDTO(thread),
          userMessage: toMessageDTO(userMessage),
          assistantMessage: toMessageDTO(assistantMessage),
          streamUrl: `/api/thread-chat/v1/messages/${assistantMessage.id}/stream`,
        }
      },
    })
  )
}
