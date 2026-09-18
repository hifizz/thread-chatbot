import type { ArtifactSummaryDTO } from "./dto"
import { z } from "zod"
import { DOCUMENT_LIMITS, DOCUMENT_RECEIPT_KIND, DOCUMENT_UNAVAILABLE_FAILURE } from "@/constants/project-documents"

const projectDocumentIdSchema = z.uuid().describe("本应用项目文档 ID：findProjectDocuments 结果的 id、成功读取的 document.id 或系统项目文档上下文的 documentId。不是 artifactId、revisionId、网页 docId、URL 或仓库路径。")
export type DocumentToolFailure = typeof DOCUMENT_UNAVAILABLE_FAILURE

export const markdownEditSchema = z.object({
  oldText: z.string().min(1).max(DOCUMENT_LIMITS.contentChars),
  newText: z.string().max(DOCUMENT_LIMITS.contentChars),
}).strict()
export const updateDocumentInputSchema = z.object({
  documentId: projectDocumentIdSchema,
  expectedRevisionId: z.uuid().describe("本轮完整读取最新版返回的 revision.id，不是 documentId。"),
  readId: z.uuid().describe("本轮 readProjectDocument 成功返回的 readId，不得使用旧轮次收据。"),
  edits: z.array(markdownEditSchema).min(1).max(DOCUMENT_LIMITS.edits),
  changeSummary: z.string().trim().min(1).max(DOCUMENT_LIMITS.summaryChars),
}).strict()
export const readDocumentInputSchema = z.object({
  documentId: projectDocumentIdSchema,
  revisionId: z.uuid().optional().describe("仅读取该文档的历史版本时填写；读取最新版或准备修改时省略。不是 documentId。"),
}).strict()
export const findDocumentsInputSchema = z.object({
  query: z.string().max(200).optional().describe("本应用内已保存项目文档的标题关键词；省略则列出候选。不是网页搜索词或 URL。"),
  artifactId: z.uuid().optional().describe("来自本应用 @artifact 引用的 artifactId；本工具将其定位为项目文档。不可直接当作 documentId。"),
}).strict()
export type MarkdownEdit = z.infer<typeof markdownEditSchema>
export type UpdateDocumentInput = z.infer<typeof updateDocumentInputSchema>
export type DocumentEditError = "SOURCE_NOT_FOUND" | "SOURCE_AMBIGUOUS" | "OVERLAPPING_EDITS" | "INVALID_EDIT"
export interface DocumentDTO {
  id: string; projectId: string; currentRevisionId: string; title: string
}
export interface DocumentListItemDTO extends DocumentDTO {
  revisionNumber: number
  sourceMessageStatus: DocumentRevisionSummaryDTO["sourceMessageStatus"]
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
export const documentUpdateNoticesSchema = z.object({
  schemaVersion: z.literal(1),
  documents: z.array(z.object({
    documentId: z.uuid(), revisionId: z.uuid(), artifactId: z.uuid(),
    revisionNumber: z.number().int().positive(), title: z.string(),
    changes: z.array(z.object({
      commitId: z.uuid(), revisionNumber: z.number().int().positive(),
      summary: z.string(), sourceThreadId: z.uuid(), sourceMessageId: z.uuid(),
    }).strict()).max(DOCUMENT_LIMITS.noticeChanges),
    omittedChangeCount: z.number().int().nonnegative(),
  }).strict()),
}).strict()
export type DocumentUpdateNotices = z.infer<typeof documentUpdateNoticesSchema>
export const documentContextReceiptSchema = z.discriminatedUnion("kind", [
  documentUpdatesSchema.extend({ kind: z.literal(DOCUMENT_RECEIPT_KIND.updates) }),
  documentUpdateNoticesSchema.extend({ kind: z.literal(DOCUMENT_RECEIPT_KIND.notices) }),
])
export type DocumentContextReceipt = z.infer<typeof documentContextReceiptSchema>
/** 仅数据库读取边界允许没有 kind 的既有收据，新写入必须使用带标签类型。 */
export type StoredDocumentContextReceipt = DocumentContextReceipt | ProjectDocumentUpdates | DocumentUpdateNotices

export function parseDocumentContextReceipt(value: unknown): DocumentContextReceipt {
  if (typeof value === "object" && value !== null && "kind" in value) {
    return documentContextReceiptSchema.parse(value)
  }
  const updates = documentUpdatesSchema.safeParse(value)
  if (updates.success) return { ...updates.data, kind: DOCUMENT_RECEIPT_KIND.updates }
  return { ...documentUpdateNoticesSchema.parse(value), kind: DOCUMENT_RECEIPT_KIND.notices }
}
/** messageId 是既有 assistant 执行身份，每次 retry 创建独立消息。 */
export interface DocumentExecution {
  userId: string; projectId: string; threadId: string; messageId: string
}

export interface DocumentCommitDTO {
  id: string; documentId: string; revisionNumber: number; changeSummary: string
  sourceThreadId: string; sourceMessageId: string; createdAt: string
}
export interface ProjectDocumentsDTO {
  artifacts: ArtifactSummaryDTO[]
  documents: DocumentListItemDTO[]
}
