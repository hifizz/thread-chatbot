import { ZodError } from "zod"
import { ThreadChatDomainError } from "../../domain/domain-error"
import type { ApiErrorCode } from "../contracts"

export class ThreadChatApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = "ThreadChatApiError"
  }
}

const domainErrorMap: Partial<
  Record<ThreadChatDomainError["code"], { code: ApiErrorCode; status: number }>
> = {
  project_owner_mismatch: { code: "forbidden", status: 403 },
  thread_archived: { code: "thread_archived", status: 409 },
  thread_generation_in_progress: {
    code: "thread_generation_in_progress",
    status: 409,
  },
  root_thread_title_owned_by_project: {
    code: "root_thread_title_owned_by_project",
    status: 422,
  },
  root_thread_archive_owned_by_project: {
    code: "root_thread_archive_owned_by_project",
    status: 422,
  },
  message_not_editable: { code: "message_not_editable", status: 422 },
  message_not_regeneratable: {
    code: "message_not_regeneratable",
    status: 422,
  },
  feedback_not_eligible: {
    code: "message_not_feedback_eligible",
    status: 422,
  },
  fork_required: { code: "fork_required", status: 422 },
  fork_anchor_mismatch: { code: "fork_anchor_mismatch", status: 422 },
  message_not_fork_eligible: {
    code: "fork_source_not_finalized",
    status: 422,
  },
  message_not_finalized: {
    code: "fork_source_not_finalized",
    status: 422,
  },
  message_superseded: { code: "fork_source_superseded", status: 422 },
  thread_source_invalid: {
    code: "fork_source_thread_mismatch",
    status: 422,
  },
  thread_not_found: { code: "thread_not_found", status: 404 },
  message_not_found: { code: "message_not_found", status: 404 },
  source_message_not_found: {
    code: "source_message_not_found",
    status: 404,
  },
  assistant_message_not_found: {
    code: "assistant_message_not_found",
    status: 404,
  },
  message_run_not_found: { code: "message_run_not_found", status: 404 },
}

export function errorResponse(
  error: unknown,
  fallbackNotFound: ApiErrorCode = "internal_error"
): Response {
  if (error instanceof ThreadChatApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      { status: error.status }
    )
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "Request validation failed.",
          details: error.issues,
        },
      },
      { status: 400 }
    )
  }
  if (error instanceof ThreadChatDomainError) {
    if (error.code === "entity_not_found") {
      return Response.json(
        { error: { code: fallbackNotFound, message: error.message } },
        { status: 404 }
      )
    }
    const mapped = domainErrorMap[error.code]
    if (mapped) {
      return Response.json(
        { error: { code: mapped.code, message: error.message } },
        { status: mapped.status }
      )
    }
  }
  console.error("[thread-chat-api] unhandled error", error)
  return Response.json(
    { error: { code: "internal_error", message: "Internal server error." } },
    { status: 500 }
  )
}
