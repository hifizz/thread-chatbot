import { z } from "zod"
import { DOCUMENT_LIMITS } from "@/constants/project-documents"

export const markdownEditSchema = z.object({
  oldText: z.string().min(1).max(DOCUMENT_LIMITS.contentChars),
  newText: z.string().max(DOCUMENT_LIMITS.contentChars),
}).strict()
export const updateDocumentInputSchema = z.object({
  documentId: z.uuid(), expectedRevisionId: z.uuid(), readId: z.uuid(),
  edits: z.array(markdownEditSchema).min(1).max(DOCUMENT_LIMITS.edits),
  changeSummary: z.string().trim().min(1).max(DOCUMENT_LIMITS.summaryChars),
}).strict()
export const readDocumentInputSchema = z.object({
  documentId: z.uuid(), revisionId: z.uuid().optional(),
}).strict()
export const findDocumentsInputSchema = z.object({
  query: z.string().max(200).optional(), artifactId: z.uuid().optional(),
}).strict()
export type MarkdownEdit = z.infer<typeof markdownEditSchema>
export type UpdateDocumentInput = z.infer<typeof updateDocumentInputSchema>
export type DocumentEditError = "SOURCE_NOT_FOUND" | "SOURCE_AMBIGUOUS" | "OVERLAPPING_EDITS" | "INVALID_EDIT"
export interface DocumentDTO {
  id: string; projectId: string; currentRevisionId: string; title: string
  archivedAt: string | null
}
export interface DocumentListItemDTO extends DocumentDTO {
  currentArtifactId: string
  sourceThreadId: string
  sourceMessageId: string
}
export interface DocumentRevisionSummaryDTO {
  id: string; documentId: string; revisionNumber: number; parentRevisionId: string | null
  artifactId: string; title: string; changeSummary: string
  sourceThreadId: string; sourceMessageId: string; createdAt: string
  sourceMessageStatus: "generating" | "completed" | "failed" | "stopped"
}
export interface DocumentRevisionDTO extends DocumentRevisionSummaryDTO {
  content: string
}
export interface DocumentReadResult {
  document: DocumentDTO; revision: DocumentRevisionDTO; readId: string; isCurrent: boolean
}
export type UpdateDocumentResult =
  | { status: "committed"; documentId: string; previousRevisionId: string; revisionId: string; artifactId: string; changeSummary: string }
  | { status: "unchanged"; documentId: string; revisionId: string }
  | { status: "conflict"; code: "DOCUMENT_CHANGED"; documentId: string; currentRevisionId: string; requiresRead: true }
  | { status: "rejected"; code: DocumentEditError | "DOCUMENT_READ_ONLY" | "READ_REQUIRED" | "DOCUMENT_UNAVAILABLE" | "EXECUTION_INACTIVE" | "RETRY_LIMIT" | "WRITES_DISABLED" }

export const documentUpdatesSchema = z.object({
  schemaVersion: z.literal(1),
  documents: z.array(z.object({
    documentId: z.uuid(), revisionId: z.uuid(), artifactId: z.uuid(),
    commitIds: z.array(z.uuid()),
  }).strict()),
}).strict()
export type ProjectDocumentUpdates = z.infer<typeof documentUpdatesSchema>
/** messageId 是既有 assistant 执行身份，每次 retry 创建独立消息。 */
export interface DocumentExecution {
  userId: string; projectId: string; threadId: string; messageId: string
}

export interface DocumentCommitDTO {
  id: string; documentId: string; revisionNumber: number; changeSummary: string
  sourceThreadId: string; sourceMessageId: string; createdAt: string
}
export interface ProjectDocumentsDTO {
  documents: DocumentListItemDTO[]; pending: ProjectDocumentUpdates; commits: DocumentCommitDTO[]
}
