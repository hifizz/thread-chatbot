import {
  OBSERVABILITY_ERROR_CATEGORIES,
  type ObservabilityErrorCategory,
} from "@/constants/observability"

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return ""
  const record = error as Record<string, unknown>
  return typeof record.code === "string" ? record.code.toLowerCase() : ""
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const record = error as Record<string, unknown>
  return typeof record.status === "number"
    ? record.status
    : typeof record.statusCode === "number"
      ? record.statusCode
      : undefined
}

export function classifyObservabilityError(
  error: unknown
): ObservabilityErrorCategory {
  if (error instanceof DOMException && error.name === "AbortError")
    return OBSERVABILITY_ERROR_CATEGORIES.abort
  const code = errorCode(error)
  const status = errorStatus(error)
  if (code.includes("abort") || code.includes("cancel"))
    return OBSERVABILITY_ERROR_CATEGORIES.abort
  if (code.includes("timeout") || code.includes("timedout"))
    return OBSERVABILITY_ERROR_CATEGORIES.timeout
  if (status === 401 || status === 403 || code.includes("auth"))
    return OBSERVABILITY_ERROR_CATEGORIES.authentication
  if (status === 429 || code.includes("rate"))
    return OBSERVABILITY_ERROR_CATEGORIES.rateLimit
  if (code.includes("protocol")) return OBSERVABILITY_ERROR_CATEGORIES.protocol
  if (code.includes("config") || code.includes("not_ready"))
    return OBSERVABILITY_ERROR_CATEGORIES.configuration
  if (status && status >= 500) return OBSERVABILITY_ERROR_CATEGORIES.provider
  return OBSERVABILITY_ERROR_CATEGORIES.unknown
}

export function safeErrorMetadata(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError"
  const code = errorCode(error)
  return {
    errorCategory: classifyObservabilityError(error),
    errorName: name.slice(0, 100),
    ...(code ? { errorCode: code.slice(0, 100) } : {}),
  }
}
