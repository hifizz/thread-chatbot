import { db } from "@/lib/db"
import type {
  ArtifactDTO,
  MessageDTO,
  ProjectBootstrapDTO,
  ProjectDTO,
} from "@/lib/thread-chat/contracts/dto"
import { toSkillVersionSummaryDTO } from "@/lib/skills/dto"
import {
  findSkillVersionById,
  listSkillVersionsByIds,
} from "@/lib/skills/repository"
import {
  findOwnedArtifact,
  listProjectArtifactRows,
} from "@/lib/thread-chat/persistence/artifact-repository"
import {
  toArtifactDTO,
  toMessageDTO,
  toProjectDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import {
  findOwnedMessage,
  listProjectMessageRows,
} from "@/lib/thread-chat/persistence/message-repository"
import {
  findOwnedProject,
  findRootThreadId,
  listOwnedProjectRows,
} from "@/lib/thread-chat/persistence/project-repository"
import { listProjectThreadRows } from "@/lib/thread-chat/persistence/thread-repository"

export async function listProjects(
  userId: string,
  archived = false
): Promise<ProjectDTO[]> {
  const rows = await listOwnedProjectRows(db, userId, archived)
  return Promise.all(
    rows.map(async (row) => {
      const rootThreadId = await findRootThreadId(db, row.id)
      if (!rootThreadId) throw new Error("PROJECT_WITHOUT_ROOT_THREAD")
      return toProjectDTO(row, rootThreadId)
    })
  )
}

export async function getProjectBootstrap(
  userId: string,
  projectId: string
): Promise<ProjectBootstrapDTO> {
  const project = await findOwnedProject(db, userId, projectId)
  if (!project) {
    return {
      project: null,
      threads: [],
      messages: [],
      artifacts: [],
      activeGenerationIds: [],
    }
  }
  const [threadRows, messageRows, artifactRows] = await Promise.all([
    listProjectThreadRows(db, project.id),
    listProjectMessageRows(db, project.id),
    listProjectArtifactRows(db, project.id),
  ])
  const root = threadRows.find((thread) => thread.parentId === null)
  if (!root) throw new Error("PROJECT_WITHOUT_ROOT_THREAD")

  const referencedSkillVersionIds = [
    ...threadRows.flatMap((thread) =>
      thread.activeSkillVersionId ? [thread.activeSkillVersionId] : []
    ),
    ...messageRows.flatMap((message) =>
      message.skillVersionId ? [message.skillVersionId] : []
    ),
  ]
  const skillRows = await listSkillVersionsByIds(db, referencedSkillVersionIds)
  const skillByVersionId = new Map(
    skillRows.map((row) => [
      row.skillVersionId,
      toSkillVersionSummaryDTO(row),
    ])
  )

  return {
    project: toProjectDTO(project, root.id),
    threads: threadRows.map((thread) =>
      toThreadDTO(
        thread,
        thread.activeSkillVersionId
          ? (skillByVersionId.get(thread.activeSkillVersionId) ?? null)
          : null
      )
    ),
    messages: messageRows.map((message) =>
      toMessageDTO(
        message,
        message.skillVersionId
          ? (skillByVersionId.get(message.skillVersionId) ?? null)
          : null
      )
    ),
    artifacts: artifactRows.map(toArtifactDTO),
    activeGenerationIds: messageRows
      .filter((message) => message.status === "generating")
      .map((message) => message.id),
  }
}

export async function getMessage(
  userId: string,
  messageId: string
): Promise<MessageDTO | null> {
  const row = await findOwnedMessage(db, userId, messageId)
  if (!row) return null
  const skillRow = row.skillVersionId
    ? await findSkillVersionById(db, row.skillVersionId)
    : null
  return toMessageDTO(
    row,
    skillRow ? toSkillVersionSummaryDTO(skillRow) : null
  )
}

export async function getArtifact(
  userId: string,
  artifactId: string
): Promise<ArtifactDTO | null> {
  const row = await findOwnedArtifact(db, userId, artifactId)
  return row ? toArtifactDTO(row) : null
}
