import type { ApiErrorCode } from "@/lib/thread-chat/contracts/errors"

export class ConversationApplicationError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string
  ) {
    super(message)
    this.name = "ConversationApplicationError"
  }
}

export function notFound(): never {
  throw new ConversationApplicationError("NOT_FOUND", "资源不存在")
}

export function stateConflict(message: string): never {
  throw new ConversationApplicationError("STATE_CONFLICT", message)
}
