import { invariant } from "../../domain/domain-error"
import type { ProjectId, UserId } from "../../domain/ids"
import type { Project, ProjectTarget } from "../../domain/project"
import { mapProject, type ThreadChatSql } from "./database"

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
        ${input.target ? this.sql.json(input.target) : null},
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
