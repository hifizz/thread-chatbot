import { invariant } from "../../domain/domain-error"
import type { ProjectId, UserId } from "../../domain/ids"
import type { Project, ProjectTarget } from "../../domain/project"
import {
  mapProject,
  toSqlJsonText,
  toSqlTimestamp,
  type ThreadChatSql,
} from "./database"

export class ProjectRepository {
  constructor(private readonly sql: ThreadChatSql) {}

  async findOwnedById(
    actorId: UserId,
    projectId: ProjectId
  ): Promise<Project | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      select
        id,
        owner_user_id as "ownerUserId",
        auto_title as "autoTitle",
        custom_title as "customTitle",
        target,
        instruction,
        archived_at as "archivedAt",
        artifact_change_sequence as "artifactChangeSequence",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from thread_chat.projects
      where id = ${projectId} and owner_user_id = ${actorId}
    `
    return row ? mapProject(row) : null
  }

  async insert(input: {
    id: ProjectId
    ownerUserId: UserId
    autoTitle?: string | null
    customTitle?: string | null
    target?: ProjectTarget | null
    instruction?: string | null
  }): Promise<Project> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      insert into thread_chat.projects (
        id, owner_user_id, auto_title, custom_title, target, instruction
      ) values (
        ${input.id},
        ${input.ownerUserId},
        ${input.autoTitle ?? null},
        ${input.customTitle ?? null},
        ${input.target ? toSqlJsonText(input.target) : null}::jsonb,
        ${input.instruction ?? null}
      )
      returning
        id,
        owner_user_id as "ownerUserId",
        auto_title as "autoTitle",
        custom_title as "customTitle",
        target,
        instruction,
        archived_at as "archivedAt",
        artifact_change_sequence as "artifactChangeSequence",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `
    return mapProject(row)
  }

  async listOwned(input: {
    actorId: UserId
    status: "active" | "archived" | "all"
    limit: number
    before?: { updatedAt: Date; id: ProjectId }
  }): Promise<Array<Project & { threadCount: number; messageCount: number }>> {
    const rows = await this.sql<Record<string, unknown>[]>`
      select
        p.id,
        p.owner_user_id as "ownerUserId",
        p.auto_title as "autoTitle",
        p.custom_title as "customTitle",
        p.target,
        p.instruction,
        p.archived_at as "archivedAt",
        p.artifact_change_sequence as "artifactChangeSequence",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt",
        count(distinct t.id)::integer as "threadCount",
        count(distinct m.id)::integer as "messageCount"
      from thread_chat.projects p
      left join thread_chat.threads t on t.project_id = p.id
      left join thread_chat.messages m on m.thread_id = t.id
      where p.owner_user_id = ${input.actorId}
        and (${input.status} = 'all'
          or (${input.status} = 'active' and p.archived_at is null)
          or (${input.status} = 'archived' and p.archived_at is not null))
        and (${toSqlTimestamp(input.before?.updatedAt)}::timestamptz is null
          or (p.updated_at, p.id) < (${toSqlTimestamp(input.before?.updatedAt)}::timestamptz, ${input.before?.id ?? null}::uuid))
      group by p.id
      order by p.updated_at desc, p.id desc
      limit ${input.limit}
    `
    return rows.map((row) => ({
      ...mapProject(row),
      threadCount: Number(row.threadCount),
      messageCount: Number(row.messageCount),
    }))
  }

  async updateMetadata(input: {
    actorId: UserId
    projectId: ProjectId
    customTitle?: string | null
    target?: ProjectTarget | null
    instruction?: string | null
  }): Promise<Project | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      update thread_chat.projects
      set custom_title = case when ${input.customTitle !== undefined} then ${input.customTitle ?? null} else custom_title end,
          target = case when ${input.target !== undefined} then ${input.target ? toSqlJsonText(input.target) : null}::jsonb else target end,
          instruction = case when ${input.instruction !== undefined} then ${input.instruction ?? null} else instruction end,
          updated_at = now()
      where id = ${input.projectId} and owner_user_id = ${input.actorId}
      returning
        id, owner_user_id as "ownerUserId", auto_title as "autoTitle",
        custom_title as "customTitle", target, instruction,
        archived_at as "archivedAt",
        artifact_change_sequence as "artifactChangeSequence",
        created_at as "createdAt", updated_at as "updatedAt"
    `
    return row ? mapProject(row) : null
  }

  async setArchived(input: {
    actorId: UserId
    projectId: ProjectId
    archived: boolean
    now: Date
  }): Promise<Project | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      update thread_chat.projects
      set archived_at = case
            when ${input.archived} then coalesce(
              archived_at,
              ${toSqlTimestamp(input.now)}::timestamptz
            )
            else null
          end,
          updated_at = case
            when (${input.archived} and archived_at is null)
              or (not ${input.archived} and archived_at is not null)
            then now()
            else updated_at
          end
      where id = ${input.projectId} and owner_user_id = ${input.actorId}
      returning
        id, owner_user_id as "ownerUserId", auto_title as "autoTitle",
        custom_title as "customTitle", target, instruction,
        archived_at as "archivedAt",
        artifact_change_sequence as "artifactChangeSequence",
        created_at as "createdAt", updated_at as "updatedAt"
    `
    return row ? mapProject(row) : null
  }

  async assertOwnedForUpdate(
    actorId: UserId,
    projectId: ProjectId
  ): Promise<void> {
    const [row] = await this.sql`
      select id
      from thread_chat.projects
      where id = ${projectId} and owner_user_id = ${actorId}
      for update
    `
    invariant(
      row,
      "project_owner_mismatch",
      "Project 不存在或不属于当前 actor。"
    )
  }

  async deleteOwned(actorId: UserId, projectId: ProjectId): Promise<boolean> {
    const result = await this.sql`
      delete from thread_chat.projects
      where id = ${projectId} and owner_user_id = ${actorId}
    `
    return result.count === 1
  }
}
