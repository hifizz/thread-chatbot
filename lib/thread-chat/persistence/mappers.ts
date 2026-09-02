import { ATTACHMENT_URL_PREFIX } from "@/constants/attachment"
import type {
  artifacts,
  attachments,
  messages,
  projects,
  threads,
} from "@/lib/db/schema"
import type {
  ArtifactDTO,
  MessageDTO,
  ProjectDTO,
  ProjectFileDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { ConversationMessage } from "@/lib/thread-chat/domain/conversation"

type ProjectRow = typeof projects.$inferSelect
type ThreadRow = typeof threads.$inferSelect
type MessageRow = typeof messages.$inferSelect
type ArtifactRow = typeof artifacts.$inferSelect
type AttachmentRow = typeof attachments.$inferSelect

export interface ProjectFileRow {
  projectId: string
  addedAt: Date
  attachment: AttachmentRow
}

export interface ArtifactSourceRow {
  artifact: ArtifactRow
  sourceThreadCustomTitle: string | null
  sourceThreadAutoTitle: string | null
  sourceThreadFootnote: number | null
  sourceMessageStatus: MessageRow["status"]
}

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
    target: row.target,
    instructions: row.instructions,
    contractVersion: row.contractVersion,
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toProjectFileDTO(row: ProjectFileRow): ProjectFileDTO {
  const attachment = row.attachment
  return {
    projectId: row.projectId,
    attachmentId: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    status: attachment.status,
    pageCount: attachment.pageCount,
    summary: attachment.summary,
    suggestedQuestions: attachment.suggestedQuestions,
    error: attachment.error,
    url: `${ATTACHMENT_URL_PREFIX}${attachment.id}`,
    addedAt: row.addedAt.toISOString(),
    createdAt: attachment.createdAt.toISOString(),
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

export function toArtifactDTO(row: ArtifactSourceRow): ArtifactDTO {
  const artifact = row.artifact
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    threadId: artifact.threadId,
    sourceMessageId: artifact.sourceMessageId,
    sourceThreadTitle:
      row.sourceThreadCustomTitle ?? row.sourceThreadAutoTitle ?? null,
    sourceThreadFootnote: row.sourceThreadFootnote,
    sourceMessageStatus: row.sourceMessageStatus,
    kind: artifact.kind,
    title: artifact.title,
    content: artifact.content,
    language: artifact.language,
    metadata: artifact.metadata,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  }
}
