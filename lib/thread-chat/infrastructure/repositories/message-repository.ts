import type { UIMessage } from "ai"
import { assertMessageCanBeReplaced, type Message } from "../../domain/message"
import { invariant } from "../../domain/domain-error"
import type { MessageId, ThreadId, UserId } from "../../domain/ids"
import { mapMessage, toSqlJson, type ThreadChatSql } from "./database"

export class MessageRepository {
  constructor(private readonly sql: ThreadChatSql) {}

  async findOwnedById(
    actorId: UserId,
    messageId: MessageId
  ): Promise<Message | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      select
        m.id,
        m.thread_id as "threadId",
        m.sequence,
        m.role,
        m.parts,
        m.replaces_message_id as "replacesMessageId",
        m.superseded_at as "supersededAt",
        m.finalized_at as "finalizedAt",
        m.created_at as "createdAt"
      from thread_chat.messages m
      join thread_chat.threads t on t.id = m.thread_id
      join thread_chat.projects p on p.id = t.project_id
      where m.id = ${messageId} and p.owner_user_id = ${actorId}
    `
    return row ? mapMessage(row) : null
  }

  async listEffectiveOwned(
    actorId: UserId,
    threadId: ThreadId,
    limit = 200
  ): Promise<Message[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      select * from (
        select
          m.id,
          m.thread_id as "threadId",
          m.sequence,
          m.role,
          m.parts,
          m.replaces_message_id as "replacesMessageId",
          m.superseded_at as "supersededAt",
          m.finalized_at as "finalizedAt",
          m.created_at as "createdAt"
        from thread_chat.messages m
        join thread_chat.threads t on t.id = m.thread_id
        join thread_chat.projects p on p.id = t.project_id
        where m.thread_id = ${threadId}
          and m.superseded_at is null
          and p.owner_user_id = ${actorId}
        order by m.sequence desc
        limit ${limit}
      ) window
      order by sequence asc
    `
    return rows.map(mapMessage)
  }

  /** 锁定 Thread 后分配 sequence，并在同一事务完成 insert。 */
  async append(input: {
    actorId: UserId
    id: MessageId
    threadId: ThreadId
    role: Message["role"]
    parts: UIMessage["parts"] | null
    finalizedAt: Date | null
    replacesMessageId?: MessageId | null
  }): Promise<Message> {
    const [thread] = await this.sql`
      select t.id
      from thread_chat.threads t
      join thread_chat.projects p on p.id = t.project_id
      where t.id = ${input.threadId} and p.owner_user_id = ${input.actorId}
      for update of t
    `
    invariant(
      thread,
      "project_owner_mismatch",
      "Thread 不存在或不属于当前 actor。"
    )

    let source: Message | null = null
    if (input.replacesMessageId) {
      const [sourceRow] = await this.sql<Record<string, unknown>[]>`
        select
          id,
          thread_id as "threadId",
          sequence,
          role,
          parts,
          replaces_message_id as "replacesMessageId",
          superseded_at as "supersededAt",
          finalized_at as "finalizedAt",
          created_at as "createdAt"
        from thread_chat.messages
        where id = ${input.replacesMessageId}
        for update
      `
      invariant(sourceRow, "entity_not_found", "replacement source 不存在。")
      source = mapMessage(sourceRow)
      assertMessageCanBeReplaced(source, {
        threadId: input.threadId,
        role: input.role,
        replacesMessageId: input.replacesMessageId,
      })
    }

    const [sequenceRow] = await this.sql<{ nextSequence: number }[]>`
      select coalesce(max(sequence), 0)::integer + 1 as "nextSequence"
      from thread_chat.messages
      where thread_id = ${input.threadId}
    `
    const [row] = await this.sql<Record<string, unknown>[]>`
      insert into thread_chat.messages (
        id,
        thread_id,
        sequence,
        role,
        parts,
        replaces_message_id,
        finalized_at
      ) values (
        ${input.id},
        ${input.threadId},
        ${sequenceRow.nextSequence},
        ${input.role},
        ${input.parts === null ? null : this.sql.json(toSqlJson(input.parts))},
        ${input.replacesMessageId ?? null},
        ${input.finalizedAt}
      )
      returning
        id,
        thread_id as "threadId",
        sequence,
        role,
        parts,
        replaces_message_id as "replacesMessageId",
        superseded_at as "supersededAt",
        finalized_at as "finalizedAt",
        created_at as "createdAt"
    `

    if (source) {
      await this.sql`
        update thread_chat.messages
        set superseded_at = now()
        where id = ${source.id} and superseded_at is null
      `
    }
    return mapMessage(row)
  }

  /** finalized assistant parts 是单次封存，不提供 finalized Message 的通用更新入口。 */
  async finalizeAssistantOnce(input: {
    actorId: UserId
    messageId: MessageId
    parts: UIMessage["parts"]
    finalizedAt: Date
  }): Promise<Message | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      update thread_chat.messages m
      set parts = ${this.sql.json(toSqlJson(input.parts))},
          finalized_at = ${input.finalizedAt}
      from thread_chat.threads t, thread_chat.projects p
      where m.id = ${input.messageId}
        and m.thread_id = t.id
        and t.project_id = p.id
        and p.owner_user_id = ${input.actorId}
        and m.role = 'assistant'
        and m.finalized_at is null
      returning
        m.id,
        m.thread_id as "threadId",
        m.sequence,
        m.role,
        m.parts,
        m.replaces_message_id as "replacesMessageId",
        m.superseded_at as "supersededAt",
        m.finalized_at as "finalizedAt",
        m.created_at as "createdAt"
    `
    return row ? mapMessage(row) : null
  }
}
