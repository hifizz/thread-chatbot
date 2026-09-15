import type { DocumentListItemDTO } from "../../contracts/document"
import type { ArtifactSummaryDTO } from "../../contracts/dto"

interface DocumentListItemRow {
  documentId: string
  documentRevisionId: string
  documentRevisionNumber: number
  artifact: Pick<ArtifactSummaryDTO, "id" | "projectId" | "title" | "threadId" | "sourceMessageId">
  sourceMessageStatus: DocumentListItemDTO["sourceMessageStatus"]
}

/** 调用方以同一 SQL 快照提供 head 与产物；此处只组装 DTO，不额外查询或推断版本。 */
export function toDocumentListItemDTO(row: DocumentListItemRow): DocumentListItemDTO {
  return {
    id: row.documentId,
    projectId: row.artifact.projectId,
    currentRevisionId: row.documentRevisionId,
    currentArtifactId: row.artifact.id,
    title: row.artifact.title,
    revisionNumber: row.documentRevisionNumber,
    sourceMessageStatus: row.sourceMessageStatus,
    sourceThreadId: row.artifact.threadId,
    sourceMessageId: row.artifact.sourceMessageId,
  }
}
