import { documentWritesEnabled } from "../../application/documents/configuration"
import { tool } from "ai"
import {
  DOCUMENT_COMMIT_DESCRIPTION,
  DOCUMENT_EDIT_DESCRIPTION,
  DOCUMENT_FIND_DESCRIPTION,
  DOCUMENT_READ_DESCRIPTION,
  DOCUMENT_RESET_DESCRIPTION,
  DOCUMENT_UPDATE_DESCRIPTION,
} from "@/constants/project-documents"
import {
  commitDocumentInputSchema,
  editDocumentInputSchema,
  findDocumentsInputSchema,
  readDocumentInputSchema,
  resetDocumentDraftInputSchema,
  updateDocumentInputSchema,
  type DocumentExecution,
} from "../../contracts/document"
import { findProjectDocuments } from "../../application/documents/service"
import {
  commitProjectDocument,
  editProjectDocument,
  readProjectDocument,
  resetProjectDocumentDraft,
} from "../../application/documents/drafts"
import { updateProjectDocument } from "../../application/documents/service"
import { createDocumentToolExecutor } from "./execution"

export interface DocumentToolOptions {
  /** 评测等兼容场景显式挂载历史即时协议；生产生成不开启。 */
  legacyUpdateTool?: boolean
}

export function buildDocumentTools(identity: DocumentExecution, options: DocumentToolOptions = {}) {
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
      editProjectDocument: tool({
        description: DOCUMENT_EDIT_DESCRIPTION,
        inputSchema: editDocumentInputSchema,
        execute: (input, { toolCallId, abortSignal }) => run("editProjectDocument", input, toolCallId, abortSignal,
          () => editProjectDocument(identity, input, toolCallId)),
      }),
      commitProjectDocument: tool({
        description: DOCUMENT_COMMIT_DESCRIPTION,
        inputSchema: commitDocumentInputSchema,
        execute: (input, { toolCallId, abortSignal }) => run("commitProjectDocument", input, toolCallId, abortSignal,
          () => commitProjectDocument(identity, input, toolCallId)),
      }),
      resetProjectDocumentDraft: tool({
        description: DOCUMENT_RESET_DESCRIPTION,
        inputSchema: resetDocumentDraftInputSchema,
        execute: (input, { toolCallId, abortSignal }) => run("resetProjectDocumentDraft", input, toolCallId, abortSignal,
          () => resetProjectDocumentDraft(identity, input, toolCallId)),
      }),
      ...(options.legacyUpdateTool ? {
        updateProjectDocument: tool({
          description: DOCUMENT_UPDATE_DESCRIPTION,
          inputSchema: updateDocumentInputSchema,
          execute: (input, { toolCallId, abortSignal }) => run("updateProjectDocument", input, toolCallId, abortSignal,
            () => updateProjectDocument(identity, input, toolCallId)),
        }),
      } : {}),
    }),
  }
}
