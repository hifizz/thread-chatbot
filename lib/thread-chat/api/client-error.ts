import type { ApiErrorCode } from "./contracts"

export class ThreadChatClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message)
    this.name = "ThreadChatClientError"
  }
}
