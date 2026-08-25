import type { Artifact } from "../../domain/artifact"
import { assertArtifactProvenance } from "../../domain/artifact"
import { invariant } from "../../domain/domain-error"
import type { ArtifactId, MessageId, ProjectId, UserId } from "../../domain/ids"
import {
  mapArtifact,
  mapMessage,
  mapThread,
  toSqlJson,
  type ThreadChatSql,
} from "./database"

export class ArtifactRepository {
  constructor(private readonly sql: ThreadChatSql) {}

  async insert(input: {
    actorId: UserId
    id: ArtifactId
    projectId: ProjectId
    sourceMessageId: MessageId
    kind: string
    title: string
    content: unknown
  }): Promise<Artifact> {
    const [sourceRow] = await this.sql<Record<string, unknown>[]>`
      select
        m.id,
        m.thread_id as "threadId",
        m.sequence,
        m.role,
        m.parts,
        m.replaces_message_id as "replacesMessageId",
        m.superseded_at as "supersededAt",
        m.finalized_at as "finalizedAt",
        m.created_at as "createdAt",
        t.id as "sourceThreadId",
        t.project_id as "sourceProjectId",
        t.parent_thread_id as "parentThreadId",
        t.source_message_id as "threadSourceMessageId",
        t.fork_source_snapshot as "forkSourceSnapshot",
        t.base_context as "baseContext",
        t.auto_title as "threadAutoTitle",
        t.custom_title as "threadCustomTitle",
        t.archived_at as "threadArchivedAt",
        t.created_at as "threadCreatedAt",
        t.updated_at as "threadUpdatedAt"
      from thread_chat.messages m
      join thread_chat.threads t on t.id = m.thread_id
      join thread_chat.projects p on p.id = t.project_id
      where m.id = ${input.sourceMessageId}
        and t.project_id = ${input.projectId}
        and p.owner_user_id = ${input.actorId}
      for update of p, m
    `
    invariant(
      sourceRow,
      "artifact_provenance_invalid",
      "Artifact source 不属于 actor 的目标 Project。"
    )
    const sourceMessage = mapMessage(sourceRow)
    const sourceThread = mapThread({
      id: sourceRow.sourceThreadId,
      projectId: sourceRow.sourceProjectId,
      parentThreadId: sourceRow.parentThreadId,
      sourceMessageId: sourceRow.threadSourceMessageId,
      forkSourceSnapshot: sourceRow.forkSourceSnapshot,
      baseContext: sourceRow.baseContext,
      autoTitle: sourceRow.threadAutoTitle,
      customTitle: sourceRow.threadCustomTitle,
      archivedAt: sourceRow.threadArchivedAt,
      createdAt: sourceRow.threadCreatedAt,
      updatedAt: sourceRow.threadUpdatedAt,
    })
    assertArtifactProvenance(input, sourceMessage, sourceThread)

    const [counter] = await this.sql<{ changeSequence: number }[]>`
      update thread_chat.projects
      set artifact_change_sequence = artifact_change_sequence + 1,
          updated_at = now()
      where id = ${input.projectId} and owner_user_id = ${input.actorId}
      returning artifact_change_sequence as "changeSequence"
    `
    invariant(counter, "project_owner_mismatch", "Project 不属于当前 actor。")

    const [row] = await this.sql<Record<string, unknown>[]>`
      insert into thread_chat.artifacts (
        id,
        project_id,
        source_message_id,
        change_sequence,
        kind,
        title,
        content
      ) values (
        ${input.id},
        ${input.projectId},
        ${input.sourceMessageId},
        ${counter.changeSequence},
        ${input.kind},
        ${input.title},
        ${this.sql.json(toSqlJson(input.content))}
      )
      returning
        id,
        project_id as "projectId",
        source_message_id as "sourceMessageId",
        change_sequence as "changeSequence",
        kind,
        title,
        content,
        created_at as "createdAt"
    `
    return mapArtifact(row)
  }

  async findOwnedById(
    actorId: UserId,
    artifactId: ArtifactId
  ): Promise<Artifact | null> {
    const [row] = await this.sql<Record<string, unknown>[]>`
      select
        a.id,
        a.project_id as "projectId",
        a.source_message_id as "sourceMessageId",
        a.change_sequence as "changeSequence",
        a.kind,
        a.title,
        a.content,
        a.created_at as "createdAt"
      from thread_chat.artifacts a
      join thread_chat.projects p on p.id = a.project_id
      where a.id = ${artifactId} and p.owner_user_id = ${actorId}
    `
    return row ? mapArtifact(row) : null
  }
}
