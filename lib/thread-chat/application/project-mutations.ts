import { and, eq } from "drizzle-orm"
import {
  projectFiles,
  projects,
  threads,
} from "@/lib/db/schema"
import { PROJECT_WORKSPACE_COPY } from "@/constants/project-workspace"
import type {
  AddProjectFileCommand,
  DeleteProjectCommand,
  RemoveProjectFileCommand,
  RenameProjectCommand,
  SetProjectArchivedCommand,
  UpdateProjectContractCommand,
  UpdateThreadCommand,
} from "@/lib/thread-chat/contracts/commands"
import { isRootThread } from "@/lib/thread-chat/domain/root-thread"
import { assertAllowedModel } from "@/lib/thread-chat/application/command-utils"
import {
  notFound,
  stateConflict,
} from "@/lib/thread-chat/application/errors"
import { executeIdempotentCommand } from "@/lib/thread-chat/persistence/command-repository"
import {
  toProjectDTO,
  toProjectFileDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import {
  findOwnedAttachmentRow,
  findProjectFileMembershipByAttachment,
  findProjectFileRow,
} from "@/lib/thread-chat/persistence/project-file-repository"
import {
  findRootThreadId,
  lockOwnedProject,
} from "@/lib/thread-chat/persistence/project-repository"
import { lockOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"
import { withConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

function normalized(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function assertWritableProject(project: { archivedAt: Date | null }): void {
  if (project.archivedAt)
    stateConflict(PROJECT_WORKSPACE_COPY.archivedReadOnly)
}

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

export function updateProjectContract(
  userId: string,
  projectId: string,
  command: UpdateProjectContractCommand
) {
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "project-contract-update",
      scopeId: projectId,
      payload: command,
      execute: async () => {
        const project = await lockOwnedProject(tx, userId, projectId)
        if (!project) notFound()
        assertWritableProject(project)
        if (project.contractVersion !== command.expectedContractVersion)
          stateConflict(PROJECT_WORKSPACE_COPY.contractConflict)
        const rootThreadId = await findRootThreadId(tx, project.id)
        if (!rootThreadId) notFound()
        const [updated] = await tx
          .update(projects)
          .set({
            target: normalized(command.target),
            instructions: normalized(command.instructions),
            contractVersion: project.contractVersion + 1,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, project.id))
          .returning()
        return toProjectDTO(updated, rootThreadId)
      },
    })
  )
}

export function addProjectFile(
  userId: string,
  projectId: string,
  command: AddProjectFileCommand
) {
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "project-file-add",
      scopeId: projectId,
      payload: command,
      execute: async () => {
        const project = await lockOwnedProject(tx, userId, projectId)
        if (!project) notFound()
        assertWritableProject(project)
        const attachment = await findOwnedAttachmentRow(
          tx,
          userId,
          command.attachmentId
        )
        if (!attachment) notFound()
        const membership = await findProjectFileMembershipByAttachment(
          tx,
          attachment.id
        )
        if (membership) {
          if (membership.projectId !== project.id)
            stateConflict(PROJECT_WORKSPACE_COPY.fileAlreadyAssigned)
          const current = await findProjectFileRow(
            tx,
            project.id,
            attachment.id
          )
          if (!current) notFound()
          return toProjectFileDTO(current)
        }
        const now = new Date()
        await tx.insert(projectFiles).values({
          projectId: project.id,
          attachmentId: attachment.id,
          addedAt: now,
        })
        await tx
          .update(projects)
          .set({ updatedAt: now })
          .where(eq(projects.id, project.id))
        return toProjectFileDTO({
          projectId: project.id,
          addedAt: now,
          attachment,
        })
      },
    })
  )
}

export function removeProjectFile(
  userId: string,
  projectId: string,
  command: RemoveProjectFileCommand
) {
  return withConversationTransaction(async (tx) =>
    executeIdempotentCommand({
      tx,
      userId,
      commandId: command.commandId,
      kind: "project-file-remove",
      scopeId: projectId,
      payload: command,
      execute: async () => {
        const project = await lockOwnedProject(tx, userId, projectId)
        if (!project) notFound()
        assertWritableProject(project)
        const [removed] = await tx
          .delete(projectFiles)
          .where(
            and(
              eq(projectFiles.projectId, project.id),
              eq(projectFiles.attachmentId, command.attachmentId)
            )
          )
          .returning({ attachmentId: projectFiles.attachmentId })
        if (!removed) notFound()
        await tx
          .update(projects)
          .set({ updatedAt: new Date() })
          .where(eq(projects.id, project.id))
        return {
          projectId: project.id,
          attachmentId: removed.attachmentId,
          removed: true as const,
        }
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
