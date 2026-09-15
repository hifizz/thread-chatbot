import { documentWritesEnabled } from "../../application/documents/configuration"
import { tool } from "ai"
import { DOCUMENT_UPDATE_DESCRIPTION } from "@/constants/project-documents"
import { findDocumentsInputSchema, readDocumentInputSchema, updateDocumentInputSchema, type DocumentExecution } from "../../contracts/document"
import { findProjectDocuments, readProjectDocument, updateProjectDocument } from "../../application/documents/service"

export function buildDocumentTools(identity: DocumentExecution) {
  return {
    findProjectDocuments: tool({
      description: "查找本项目已有文档。优先使用 @artifact 的 artifactId；名称可能有多个候选，不能猜测。",
      inputSchema: findDocumentsInputSchema,
      execute: (input) => findProjectDocuments(identity, input),
    }),
    readProjectDocument: tool({
      description: "读取指定文档完整 Markdown 和固定版本，返回 readId。准备更新时不传 revisionId，读取最新版。",
      inputSchema: readDocumentInputSchema,
      execute: (input, { toolCallId }) => readProjectDocument(identity, input, toolCallId),
    }),
    ...(!documentWritesEnabled() ? {} : {
      updateProjectDocument: tool({
        description: DOCUMENT_UPDATE_DESCRIPTION,
        inputSchema: updateDocumentInputSchema,
        execute: (input, { toolCallId }) => updateProjectDocument(identity, input, toolCallId),
      }),
    }),
  }
}
