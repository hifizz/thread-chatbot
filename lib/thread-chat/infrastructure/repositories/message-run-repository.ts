import type { UIMessage } from "ai"
import { invariant } from "../../domain/domain-error"
import type { MessageId, MessageRunId, UserId } from "../../domain/ids"
import {
  assertMessageRunTransition,
  type MessageRun,
  type MessageRunStatus,
} from "../../domain/message-run"
import { mapMessageRun, toSqlJson, type ThreadChatSql } from "./database"

export class MessageRunRepository {
  constructor(private readonly sql: ThreadChatSql) {}

  async insertQueued(input: {
    actorId: UserId
    id: MessageRunId
    assistantMessageId: MessageId
    modelId: string
  }): Promise<MessageRun> {
    const [message] = await this.sql`
      select m.id
      from thread_chat.messages m
      join thread_chat.threads t on t.id = m.thread_id
      join thread_chat.projects p on p.id = t.project_id
      where m.id = ${input.assistantMessageId}
        and m.role = 'assistant'
        and p.owner_user_id = ${input.actorId}
      for update of m
    `
    invariant(
      message,
      "project_owner_mismatch",
      "Message 不属于 actor，或不是 assistant Message。"
    )
    const [row] = await this.sql<Record<string, unknown>[]>`
      insert into thread_chat.message_runs (
        id, assistant_message_id, status, model_id
      ) values (
        ${input.id}, ${input.assistantMessageId}, 'queued', ${input.modelId}
      )
      returning
        id,
        assistant_message_id as "assistantMessageId",
        status,
        model_id as "modelId",
        event_sequence as "eventSequence",
        checkpoint_parts as "checkpointParts",
        error_code as "errorCode",
        error_message as "errorMessage",
        heartbeat_at as "heartbeatAt",
        stop_requested_at as "stopRequestedAt",
        finished_at as "finishedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `
    return mapMessageRun(row)
  }

  async findOwnedByAssistantMessageId(
    actorId: UserId,
    assistantMessageId: MessageId
  ): Promise<MessageRun | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      select
        r.id,
        r.assistant_message_id as "assistantMessageId",
        r.status,
        r.model_id as "modelId",
        r.event_sequence as "eventSequence",
        r.checkpoint_parts as "checkpointParts",
        r.error_code as "errorCode",
        r.error_message as "errorMessage",
        r.heartbeat_at as "heartbeatAt",
        r.stop_requested_at as "stopRequestedAt",
        r.finished_at as "finishedAt",
        r.created_at as "createdAt",
        r.updated_at as "updatedAt"
      from thread_chat.message_runs r
      join thread_chat.messages m on m.id = r.assistant_message_id
      join thread_chat.threads t on t.id = m.thread_id
      join thread_chat.projects p on p.id = t.project_id
      where r.assistant_message_id = ${assistantMessageId}
        and p.owner_user_id = ${actorId}
    `
    return row ? mapMessageRun(row) : null
  }

  async findOwnedByAssistantMessageIdForUpdate(
    actorId: UserId,
    assistantMessageId: MessageId
  ): Promise<MessageRun | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      select
        r.id, r.assistant_message_id as "assistantMessageId", r.status,
        r.model_id as "modelId", r.event_sequence as "eventSequence",
        r.checkpoint_parts as "checkpointParts", r.error_code as "errorCode",
        r.error_message as "errorMessage", r.heartbeat_at as "heartbeatAt",
        r.stop_requested_at as "stopRequestedAt", r.finished_at as "finishedAt",
        r.created_at as "createdAt", r.updated_at as "updatedAt"
      from thread_chat.message_runs r
      join thread_chat.messages m on m.id = r.assistant_message_id
      join thread_chat.threads t on t.id = m.thread_id
      join thread_chat.projects p on p.id = t.project_id
      where r.assistant_message_id = ${assistantMessageId}
        and p.owner_user_id = ${actorId}
      for update of r
    `
    return row ? mapMessageRun(row) : null
  }

  async findOwnedByAssistantMessageIds(
    actorId: UserId,
    assistantMessageIds: readonly MessageId[]
  ): Promise<MessageRun[]> {
    if (assistantMessageIds.length === 0) return []
    const rows = await this.sql<Record<string, unknown>[]>`
      select
        r.id, r.assistant_message_id as "assistantMessageId", r.status,
        r.model_id as "modelId", r.event_sequence as "eventSequence",
        r.checkpoint_parts as "checkpointParts", r.error_code as "errorCode",
        r.error_message as "errorMessage", r.heartbeat_at as "heartbeatAt",
        r.stop_requested_at as "stopRequestedAt", r.finished_at as "finishedAt",
        r.created_at as "createdAt", r.updated_at as "updatedAt"
      from thread_chat.message_runs r
      join thread_chat.messages m on m.id = r.assistant_message_id
      join thread_chat.threads t on t.id = m.thread_id
      join thread_chat.projects p on p.id = t.project_id
      where r.assistant_message_id in ${this.sql(assistantMessageIds)}
        and p.owner_user_id = ${actorId}
    `
    return rows.map(mapMessageRun)
  }

  async assertNoActiveForThread(actorId: UserId, threadId: string): Promise<void> {
    const [row] = await this.sql`
      select r.id
      from thread_chat.threads t
      join thread_chat.projects p on p.id = t.project_id
      join thread_chat.messages m on m.thread_id = t.id
      join thread_chat.message_runs r on r.assistant_message_id = m.id
      where t.id = ${threadId}
        and p.owner_user_id = ${actorId}
        and r.status in ('queued', 'running')
      for update of r
      limit 1
    `
    invariant(
      !row,
      "thread_generation_in_progress",
      "Thread 已有 queued 或 running MessageRun。"
    )
  }

  async transition(input: {
    actorId: UserId
    messageRunId: MessageRunId
    expectedStatus: MessageRunStatus
    nextStatus: MessageRunStatus
    finishedAt?: Date | null
    error?: { code: string; message: string } | null
  }): Promise<MessageRun | null> {
    assertMessageRunTransition(input.expectedStatus, input.nextStatus)
    const [row] = await this.sql<Record<string, unknown>[]>`
      update thread_chat.message_runs r
      set status = ${input.nextStatus},
          finished_at = ${input.finishedAt ?? null},
          error_code = ${input.error?.code ?? null},
          error_message = ${input.error?.message ?? null},
          updated_at = now()
      from thread_chat.messages m,
           thread_chat.threads t,
           thread_chat.projects p
      where r.id = ${input.messageRunId}
        and r.status = ${input.expectedStatus}
        and r.assistant_message_id = m.id
        and m.thread_id = t.id
        and t.project_id = p.id
        and p.owner_user_id = ${input.actorId}
      returning
        r.id,
        r.assistant_message_id as "assistantMessageId",
        r.status,
        r.model_id as "modelId",
        r.event_sequence as "eventSequence",
        r.checkpoint_parts as "checkpointParts",
        r.error_code as "errorCode",
        r.error_message as "errorMessage",
        r.heartbeat_at as "heartbeatAt",
        r.stop_requested_at as "stopRequestedAt",
        r.finished_at as "finishedAt",
        r.created_at as "createdAt",
        r.updated_at as "updatedAt"
    `
    return row ? mapMessageRun(row) : null
  }

  async checkpoint(input: {
    actorId: UserId
    messageRunId: MessageRunId
    expectedEventSequence: number
    checkpointParts: UIMessage["parts"]
    heartbeatAt: Date
  }): Promise<MessageRun | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      update thread_chat.message_runs r
      set checkpoint_parts = ${this.sql.json(toSqlJson(input.checkpointParts))},
          event_sequence = event_sequence + 1,
          heartbeat_at = ${input.heartbeatAt},
          updated_at = now()
      from thread_chat.messages m,
           thread_chat.threads t,
           thread_chat.projects p
      where r.id = ${input.messageRunId}
        and r.status = 'running'
        and r.event_sequence = ${input.expectedEventSequence}
        and r.assistant_message_id = m.id
        and m.thread_id = t.id
        and t.project_id = p.id
        and p.owner_user_id = ${input.actorId}
      returning
        r.id,
        r.assistant_message_id as "assistantMessageId",
        r.status,
        r.model_id as "modelId",
        r.event_sequence as "eventSequence",
        r.checkpoint_parts as "checkpointParts",
        r.error_code as "errorCode",
        r.error_message as "errorMessage",
        r.heartbeat_at as "heartbeatAt",
        r.stop_requested_at as "stopRequestedAt",
        r.finished_at as "finishedAt",
        r.created_at as "createdAt",
        r.updated_at as "updatedAt"
    `
    return row ? mapMessageRun(row) : null
  }

  async requestStop(
    actorId: UserId,
    assistantMessageId: MessageId,
    requestedAt: Date
  ): Promise<MessageRun | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      update thread_chat.message_runs r
      set stop_requested_at = coalesce(r.stop_requested_at, ${requestedAt}),
          updated_at = now()
      from thread_chat.messages m,
           thread_chat.threads t,
           thread_chat.projects p
      where r.assistant_message_id = ${assistantMessageId}
        and r.status in ('queued', 'running')
        and r.assistant_message_id = m.id
        and m.thread_id = t.id
        and t.project_id = p.id
        and p.owner_user_id = ${actorId}
      returning
        r.id,
        r.assistant_message_id as "assistantMessageId",
        r.status,
        r.model_id as "modelId",
        r.event_sequence as "eventSequence",
        r.checkpoint_parts as "checkpointParts",
        r.error_code as "errorCode",
        r.error_message as "errorMessage",
        r.heartbeat_at as "heartbeatAt",
        r.stop_requested_at as "stopRequestedAt",
        r.finished_at as "finishedAt",
        r.created_at as "createdAt",
        r.updated_at as "updatedAt"
    `
    return row ? mapMessageRun(row) : null
  }
}
