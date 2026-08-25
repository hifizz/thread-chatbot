import { ThreadChatClientError } from "../api/client-error"

export function normalizeClientError(error: unknown): ThreadChatClientError {
  if (error instanceof ThreadChatClientError) return error
  if (error instanceof Error && error.name === "AbortError")
    return new ThreadChatClientError(
      "internal_error",
      "Request was aborted.",
      0
    )
  return new ThreadChatClientError(
    "internal_error",
    error instanceof Error ? error.message : "Unexpected client error.",
    0
  )
}

export function clientInvariant(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition)
    throw new ThreadChatClientError("validation_error", message, 0)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}
