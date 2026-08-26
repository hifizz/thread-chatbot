import { eq } from "drizzle-orm"
import { projects, threads } from "@/lib/db/schema"
import type {
  DeleteProjectCommand,
  RenameProjectCommand,
  SetProjectArchivedCommand,
  UpdateThreadCommand,
} from "@/lib/thread-chat/contracts/commands"
import { isRootThread } from "@/lib/thread-chat/domain/root-thread"
import { assertAllowedModel } from "@/lib/thread-chat/application/command-utils"
import { notFound } from "@/lib/thread-chat/application/errors"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import {
  toProjectDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import {
  findRootThreadId,
  lockOwnedProject,
} from "@/lib/thread-chat/persistence/project-repository"
import { lockOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"
import { withConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

export function renameProject(
  userId: string,
  projectId: string,
  command: RenameProjectCommand
) {
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "rename",
      scopeId: projectId,
      payload: command,
      execute: async () => {
        const project = await lockOwnedProject(tx, userId, projectId)
        if (!project) notFound()
        const rootThreadId = await findRootThreadId(tx, project.id)
        if (!rootThreadId) notFound()
        const now = new Date()
        const [updated] = await tx
          .update(projects)
          .set({ customTitle: command.customTitle, updatedAt: now })
          .where(eq(projects.id, project.id))
          .returning()
        await tx
          .update(threads)
          .set({ customTitle: command.customTitle, updatedAt: now })
          .where(eq(threads.id, rootThreadId))
        return toProjectDTO(updated, rootThreadId)
      },
    })
  )
}

export function setProjectArchived(
  userId: string,
  projectId: string,
  command: SetProjectArchivedCommand
) {
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "archive",
      scopeId: projectId,
      payload: command,
      execute: async () => {
        const project = await lockOwnedProject(tx, userId, projectId)
        if (!project) notFound()
        const rootThreadId = await findRootThreadId(tx, project.id)
        if (!rootThreadId) notFound()
        const now = new Date()
        const [updated] = await tx
          .update(projects)
          .set({ archivedAt: command.archived ? now : null, updatedAt: now })
          .where(eq(projects.id, project.id))
          .returning()
        return toProjectDTO(updated, rootThreadId)
      },
    })
  )
}

export function deleteProject(
  userId: string,
  projectId: string,
  command: DeleteProjectCommand
) {
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "delete",
      scopeId: projectId,
      payload: command,
      execute: async () => {
        const project = await lockOwnedProject(tx, userId, projectId)
        if (!project) notFound()
        await tx.delete(projects).where(eq(projects.id, project.id))
        return { projectId, deleted: true as const }
      },
    })
  )
}

export function updateThread(
  userId: string,
  threadId: string,
  command: UpdateThreadCommand
) {
  if (command.modelId) assertAllowedModel(command.modelId)
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "thread-update",
      scopeId: threadId,
      payload: command,
      execute: async () => {
        const thread = await lockOwnedThread(tx, userId, threadId)
        if (!thread) notFound()
        const project = await lockOwnedProject(tx, userId, thread.projectId)
        if (!project) notFound()
        const now = new Date()
        const values = {
          ...(command.modelId !== undefined
            ? { modelId: command.modelId }
            : {}),
          ...(command.customTitle !== undefined
            ? { customTitle: command.customTitle }
            : {}),
          updatedAt: now,
        }
        const [updated] = await tx
          .update(threads)
          .set(values)
          .where(eq(threads.id, thread.id))
          .returning()
        if (isRootThread(thread) && command.customTitle !== undefined) {
          await tx
            .update(projects)
            .set({ customTitle: command.customTitle, updatedAt: now })
            .where(eq(projects.id, project.id))
        }
        return toThreadDTO(updated)
      },
    })
  )
}
