import type { artifacts, messages, projects, threads } from "@/lib/db/schema"
import type {
  ArtifactDTO,
  MessageDTO,
  ProjectDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { ConversationMessage } from "@/lib/thread-chat/domain/conversation"

type ProjectRow = typeof projects.$inferSelect
type ThreadRow = typeof threads.$inferSelect
type MessageRow = typeof messages.$inferSelect
type ArtifactRow = typeof artifacts.$inferSelect

const iso = (value: Date | null): string | null => value?.toISOString() ?? null

export function toProjectDTO(
  row: ProjectRow,
  rootThreadId: string
): ProjectDTO {
  return {
    id: row.id,
    rootThreadId,
    autoTitle: row.autoTitle,
    customTitle: row.customTitle,
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toThreadDTO(row: ThreadRow): ThreadDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    forkMessageId: row.forkMessageId,
    forkContext: row.forkContext,
    forkAnchor: row.forkAnchor,
    anchorText: row.anchorText,
    footnote: row.footnote,
    depth: row.depth,
    modelId: row.modelId,
    autoTitle: row.autoTitle,
    customTitle: row.customTitle,
    titleGenerationAttempted: row.titleGenerationAttempted,
    titleGenerated: row.titleGenerated,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toMessageDTO(row: MessageRow): MessageDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    threadId: row.threadId,
    sequence: row.sequence,
    role: row.role,
    parts: row.parts,
    status: row.status,
    modelId: row.modelId,
    replacesMessageId: row.replacesMessageId,
    supersededAt: iso(row.supersededAt),
    feedback: row.feedback,
    error:
      row.errorCode && row.errorMessage
        ? { code: row.errorCode, message: row.errorMessage }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
  }
}

export function toConversationMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    sequence: row.sequence,
    role: row.role,
    parts: row.parts,
    status: row.status,
    replacesMessageId: row.replacesMessageId,
    supersededAt: iso(row.supersededAt),
  }
}

export function toArtifactDTO(row: ArtifactRow): ArtifactDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceMessageId: row.sourceMessageId,
    kind: row.kind,
    title: row.title,
    content: row.content,
    language: row.language,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
