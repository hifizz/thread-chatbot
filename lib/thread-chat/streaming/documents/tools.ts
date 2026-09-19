import { documentWritesEnabled } from "../../application/documents/configuration"
import { tool } from "ai"
import { DOCUMENT_FIND_DESCRIPTION, DOCUMENT_READ_DESCRIPTION, DOCUMENT_UPDATE_DESCRIPTION } from "@/constants/project-documents"
import { findDocumentsInputSchema, readDocumentInputSchema, updateDocumentInputSchema, type DocumentExecution } from "../../contracts/document"
import { findProjectDocuments, readProjectDocument, updateProjectDocument } from "../../application/documents/service"
import { createDocumentToolExecutor } from "./execution"

export function buildDocumentTools(identity: DocumentExecution) {
  const run = createDocumentToolExecutor()
  return {
    findProjectDocuments: tool({
      description: DOCUMENT_FIND_DESCRIPTION,
      inputSchema: findDocumentsInputSchema,
      execute: (input) => findProjectDocuments(identity, input),
    }),
    readProjectDocument: tool({
      description: DOCUMENT_READ_DESCRIPTION,
      inputSchema: readDocumentInputSchema,
      execute: (input, { toolCallId, abortSignal }) => run("readProjectDocument", input, toolCallId, abortSignal,
        () => readProjectDocument(identity, input, toolCallId)),
    }),
    ...(!documentWritesEnabled() ? {} : {
      updateProjectDocument: tool({
        description: DOCUMENT_UPDATE_DESCRIPTION,
        inputSchema: updateDocumentInputSchema,
        execute: (input, { toolCallId, abortSignal }) => run("updateProjectDocument", input, toolCallId, abortSignal,
          () => updateProjectDocument(identity, input, toolCallId)),
      }),
    }),
  }
}
