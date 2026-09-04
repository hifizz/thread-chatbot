import { db } from "@/lib/db"
import type {
  ArtifactDTO,
  MessageDTO,
  ProjectBootstrapDTO,
  ProjectListItemDTO,
} from "@/lib/thread-chat/contracts/dto"
import {
  findOwnedArtifact,
  listProjectArtifactRows,
} from "@/lib/thread-chat/persistence/artifact-repository"
import {
  toArtifactDTO,
  toMessageDTO,
  toProjectDTO,
  toProjectFileDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import {
  findOwnedMessage,
  listProjectMessageRows,
} from "@/lib/thread-chat/persistence/message-repository"
import { listProjectFileRows } from "@/lib/thread-chat/persistence/project-file-repository"
import {
  findOwnedProject,
  listOwnedProjectRows,
} from "@/lib/thread-chat/persistence/project-repository"
import { listProjectThreadRows } from "@/lib/thread-chat/persistence/thread-repository"

export async function listProjects(
  userId: string,
  archived = false
): Promise<ProjectListItemDTO[]> {
  const rows = await listOwnedProjectRows(db, userId, archived)
  return rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function getProjectBootstrap(
  userId: string,
  projectId: string
): Promise<ProjectBootstrapDTO> {
  const project = await findOwnedProject(db, userId, projectId)
  if (!project) {
    return {
      project: null,
      files: [],
      threads: [],
      messages: [],
      artifacts: [],
      activeGenerationIds: [],
    }
  }
  const [threadRows, messageRows, artifactRows, projectFileRows] =
    await Promise.all([
      listProjectThreadRows(db, project.id),
      listProjectMessageRows(db, project.id),
      listProjectArtifactRows(db, project.id),
      listProjectFileRows(db, project.id),
    ])
  const root = threadRows.find((thread) => thread.parentId === null)
  if (!root) throw new Error("PROJECT_WITHOUT_ROOT_THREAD")
  return {
    project: toProjectDTO(project, root.id),
    files: projectFileRows.map(toProjectFileDTO),
    threads: threadRows.map(toThreadDTO),
    messages: messageRows.map(toMessageDTO),
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
  return row ? toMessageDTO(row) : null
}

export async function getArtifact(
  userId: string,
  artifactId: string
): Promise<ArtifactDTO | null> {
  const row = await findOwnedArtifact(db, userId, artifactId)
  return row ? toArtifactDTO(row) : null
}
