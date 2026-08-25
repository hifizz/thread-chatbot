import {
  validateBaseContext,
  type BaseContextV1,
} from "../../domain/base-context"
import { invariant } from "../../domain/domain-error"
import type { ProjectId, ThreadId, UserId } from "../../domain/ids"
import type { ForkSourceSnapshot, Thread } from "../../domain/thread"
import {
  mapThread,
  toSqlJsonText,
  toSqlTimestamp,
  type ThreadChatSql,
} from "./database"
import { ProjectRepository } from "./project-repository"

export class ThreadRepository {
  constructor(private readonly sql: ThreadChatSql) {}

  async findOwnedById(
    actorId: UserId,
    threadId: ThreadId
  ): Promise<Thread | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      select
        t.id,
        t.project_id as "projectId",
        t.parent_thread_id as "parentThreadId",
        t.source_message_id as "sourceMessageId",
        t.fork_source_snapshot as "forkSourceSnapshot",
        t.base_context as "baseContext",
        t.auto_title as "autoTitle",
        t.custom_title as "customTitle",
        t.archived_at as "archivedAt",
        t.created_at as "createdAt",
        t.updated_at as "updatedAt"
      from thread_chat.threads t
      join thread_chat.projects p on p.id = t.project_id
      where t.id = ${threadId} and p.owner_user_id = ${actorId}
    `
    return row ? mapThread(row) : null
  }

  async findOwnedByIdForUpdate(
    actorId: UserId,
    threadId: ThreadId
  ): Promise<Thread | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      select
        t.id, t.project_id as "projectId", t.parent_thread_id as "parentThreadId",
        t.source_message_id as "sourceMessageId", t.fork_source_snapshot as "forkSourceSnapshot",
        t.base_context as "baseContext", t.auto_title as "autoTitle",
        t.custom_title as "customTitle", t.archived_at as "archivedAt",
        t.created_at as "createdAt", t.updated_at as "updatedAt"
      from thread_chat.threads t
      join thread_chat.projects p on p.id = t.project_id
      where t.id = ${threadId} and p.owner_user_id = ${actorId}
      for update of t
    `
    return row ? mapThread(row) : null
  }

  async listOwnedTopology(
    actorId: UserId,
    projectId: ProjectId
  ): Promise<Thread[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      select
        t.id,
        t.project_id as "projectId",
        t.parent_thread_id as "parentThreadId",
        t.source_message_id as "sourceMessageId",
        t.fork_source_snapshot as "forkSourceSnapshot",
        t.base_context as "baseContext",
        t.auto_title as "autoTitle",
        t.custom_title as "customTitle",
        t.archived_at as "archivedAt",
        t.created_at as "createdAt",
        t.updated_at as "updatedAt"
      from thread_chat.threads t
      join thread_chat.projects p on p.id = t.project_id
      where t.project_id = ${projectId} and p.owner_user_id = ${actorId}
      order by t.created_at, t.id
    `
    return rows.map(mapThread)
  }

  async insertRoot(input: {
    actorId: UserId
    id: ThreadId
    projectId: ProjectId
  }): Promise<Thread> {
    await new ProjectRepository(this.sql).assertOwnedForUpdate(
      input.actorId,
      input.projectId
    )
    return this.insert({ id: input.id, projectId: input.projectId })
  }

  async insertBranch(input: {
    actorId: UserId
    id: ThreadId
    projectId: ProjectId
    parentThreadId: ThreadId
    sourceMessageId: string
    forkSourceSnapshot: ForkSourceSnapshot
    baseContext: unknown
  }): Promise<Thread> {
    await new ProjectRepository(this.sql).assertOwnedForUpdate(
      input.actorId,
      input.projectId
    )
    const baseContext = validateBaseContext(input.baseContext)
    const [relation] = await this.sql`
      select 1
      from thread_chat.threads parent
      join thread_chat.messages source
        on source.id = ${input.sourceMessageId}
       and source.thread_id = parent.id
      where parent.id = ${input.parentThreadId}
        and parent.project_id = ${input.projectId}
      for update of parent, source
    `
    invariant(
      relation,
      "thread_source_invalid",
      "Parent/source Message 必须属于同一 Project 与 Parent Thread。"
    )

    return this.insert({
      id: input.id,
      projectId: input.projectId,
      parentThreadId: input.parentThreadId,
      sourceMessageId: input.sourceMessageId,
      forkSourceSnapshot: input.forkSourceSnapshot,
      baseContext,
    })
  }

  async updateBranchMetadata(input: {
    actorId: UserId
    threadId: ThreadId
    customTitle?: string | null
    archived?: boolean
    now: Date
  }): Promise<Thread | null> {
    const current = await this.findOwnedById(input.actorId, input.threadId)
    if (!current) return null
    invariant(
      current.parentThreadId !== null,
      input.archived === undefined
        ? "root_thread_title_owned_by_project"
        : "root_thread_archive_owned_by_project",
      "Root Thread 的 metadata 由 Project 管理。"
    )
    const hasArchived = input.archived !== undefined
    const archived = input.archived ?? false
    const [row] = await this.sql<Record<string, unknown>[]>`
      update thread_chat.threads t
      set custom_title = case when ${input.customTitle !== undefined} then ${input.customTitle ?? null} else t.custom_title end,
          archived_at = case
            when ${!hasArchived} then t.archived_at
            when ${archived} then coalesce(
              t.archived_at,
              ${toSqlTimestamp(input.now)}::timestamptz
            )
            else null
          end,
          updated_at = case
            when ${input.customTitle !== undefined}
              or (${hasArchived && archived} and t.archived_at is null)
              or (${hasArchived && !archived} and t.archived_at is not null)
            then now()
            else t.updated_at
          end
      from thread_chat.projects p
      where t.id = ${input.threadId}
        and t.project_id = p.id
        and p.owner_user_id = ${input.actorId}
      returning
        t.id, t.project_id as "projectId", t.parent_thread_id as "parentThreadId",
        t.source_message_id as "sourceMessageId", t.fork_source_snapshot as "forkSourceSnapshot",
        t.base_context as "baseContext", t.auto_title as "autoTitle",
        t.custom_title as "customTitle", t.archived_at as "archivedAt",
        t.created_at as "createdAt", t.updated_at as "updatedAt"
    `
    return row ? mapThread(row) : null
  }

  private async insert(input: {
    id: ThreadId
    projectId: ProjectId
    parentThreadId?: ThreadId
    sourceMessageId?: string
    forkSourceSnapshot?: ForkSourceSnapshot
    baseContext?: BaseContextV1
  }): Promise<Thread> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      insert into thread_chat.threads (
        id,
        project_id,
        parent_thread_id,
        source_message_id,
        fork_source_snapshot,
        base_context
      ) values (
        ${input.id},
        ${input.projectId},
        ${input.parentThreadId ?? null},
        ${input.sourceMessageId ?? null},
        ${
          input.forkSourceSnapshot
            ? toSqlJsonText(input.forkSourceSnapshot)
            : null
        }::jsonb,
        ${input.baseContext ? toSqlJsonText(input.baseContext) : null}::jsonb
      )
      returning
        id,
        project_id as "projectId",
        parent_thread_id as "parentThreadId",
        source_message_id as "sourceMessageId",
        fork_source_snapshot as "forkSourceSnapshot",
        base_context as "baseContext",
        auto_title as "autoTitle",
        custom_title as "customTitle",
        archived_at as "archivedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `
    return mapThread(row)
  }
}
