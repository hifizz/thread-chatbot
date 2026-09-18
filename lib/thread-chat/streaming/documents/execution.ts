import { DOCUMENT_UNAVAILABLE_FAILURE } from "@/constants/project-documents"
import { AI_DIAGNOSTIC_EVENTS } from "@/constants/observability"
import { logDiagnostic, withDiagnosticContext } from "@/lib/observability/diagnostic-log"
import { ConversationApplicationError } from "../../application/errors"
import type { DocumentToolFailure } from "../../contracts/document"

/** 每次生成独立缓存定位失败；成功调用仍各自执行，保留各自的读/写收据。 */
export function createDocumentToolExecutor() {
  const failures = new Map<string, DocumentToolFailure>()
  const pending = new Map<string, Promise<void>>()
  return async function run<T>(toolName: string, input: { documentId: string; revisionId?: string; expectedRevisionId?: string },
    toolCallId: string, signal: AbortSignal | undefined, execute: () => Promise<T>): Promise<T | DocumentToolFailure> {
    return withDiagnosticContext({ toolName, toolCallId }, async () => {
      // 只缓存 NOT_FOUND；定位由文档和版本决定，与补丁正文无关。
      const key = JSON.stringify([toolName, input.documentId, input.revisionId ?? input.expectedRevisionId ?? null])
      while (pending.has(key)) await pending.get(key)
      signal?.throwIfAborted()
      const previous = failures.get(key)
      if (previous) {
        logDiagnostic(AI_DIAGNOSTIC_EVENTS.toolFailure, { errorCode: previous.code, cached: true })
        return previous
      }
      let release!: () => void
      pending.set(key, new Promise<void>((resolve) => { release = resolve }))
      try {
        return await execute()
      } catch (error) {
        signal?.throwIfAborted()
        if (!(error instanceof ConversationApplicationError) || error.code !== "NOT_FOUND") {
          logDiagnostic(AI_DIAGNOSTIC_EVENTS.toolException, {}, error, "error")
          throw error
        }
        failures.set(key, DOCUMENT_UNAVAILABLE_FAILURE)
        logDiagnostic(AI_DIAGNOSTIC_EVENTS.toolFailure, {
          errorCode: DOCUMENT_UNAVAILABLE_FAILURE.code, nextAction: DOCUMENT_UNAVAILABLE_FAILURE.nextAction, cached: false,
        })
        return DOCUMENT_UNAVAILABLE_FAILURE
      } finally {
        pending.delete(key)
        release()
      }
    })
  }
}
