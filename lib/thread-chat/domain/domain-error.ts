export type ThreadChatDomainErrorCode =
  | "project_owner_mismatch"
  | "project_root_invalid"
  | "thread_fork_facts_invalid"
  | "thread_parent_invalid"
  | "thread_source_invalid"
  | "thread_cycle"
  | "message_not_finalized"
  | "message_superseded"
  | "message_replacement_invalid"
  | "message_not_fork_eligible"
  | "base_context_invalid"
  | "base_context_message_missing"
  | "message_run_transition_invalid"
  | "artifact_provenance_invalid"
  | "feedback_not_eligible"
  | "entity_not_found"

export class ThreadChatDomainError extends Error {
  constructor(
    readonly code: ThreadChatDomainErrorCode,
    message: string
  ) {
    super(message)
    this.name = "ThreadChatDomainError"
  }
}

export function invariant(
  condition: unknown,
  code: ThreadChatDomainErrorCode,
  message: string
): asserts condition {
  if (!condition) throw new ThreadChatDomainError(code, message)
}
