import { AI_DIAGNOSTIC_EVENTS } from "@/constants/observability"
import { AsyncLocalStorage } from "node:async_hooks"
import { getActiveSpanId, getActiveTraceId } from "@langfuse/tracing"
import { logger } from "@/lib/axiom/server"
import { safeErrorMetadata } from "@/lib/observability/error"

/** 独立于遥测 exporter；未配置 Langfuse 时也保留应用关联标识。 */
type DiagnosticContext = {
  sessionId?: string
  traceId?: string
  projectId?: string
  threadId?: string
  assistantMessageId?: string
  requestId?: string
  toolCallId?: string
  toolName?: string
}
const context = new AsyncLocalStorage<DiagnosticContext>()

export function withDiagnosticContext<T>(input: DiagnosticContext, execute: () => T): T {
  return context.run({ ...context.getStore(), ...input }, execute)
}

export function diagnosticCorrelation(): DiagnosticContext & { observationId?: string } {
  const traceId = getActiveTraceId()
  const observationId = getActiveSpanId()
  return {
    ...context.getStore(),
    ...(traceId ? { traceId } : {}),
    ...(observationId ? { observationId } : {}),
  }
}

/** 只接受内部计量字段，不传入正文、请求头或供应商响应。 */
export function logDiagnostic(
  event: (typeof AI_DIAGNOSTIC_EVENTS)[keyof typeof AI_DIAGNOSTIC_EVENTS],
  fields: Record<string, string | number | boolean | undefined> = {},
  error?: unknown,
  level: "info" | "warn" | "error" = "warn",
) {
  logger[level](event, {
    event,
    ...fields,
    ...diagnosticCorrelation(),
    ...(error === undefined ? {} : safeErrorMetadata(error)),
  })
}
