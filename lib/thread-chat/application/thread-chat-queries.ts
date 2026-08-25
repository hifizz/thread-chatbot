import { invariant } from "../domain/domain-error"
import { getProjectDisplayTitle } from "../domain/project"
import {
  createThreadChatRepositories,
  type ThreadChatSql,
} from "../infrastructure/repositories"
import type {
  ProjectBootstrap,
  ProjectSummary,
  ThreadMessageBundle,
} from "./application-types"

export class ThreadChatQueries {
  constructor(private readonly sql: ThreadChatSql) {}

  async listProjects(input: {
    actorId: string
    status?: "active" | "archived" | "all"
    limit?: number
    before?: { updatedAt: Date; id: string }
  }): Promise<ProjectSummary[]> {
    const repositories = createThreadChatRepositories(this.sql)
    const projects = await repositories.projects.listOwned({
      actorId: input.actorId,
      status: input.status ?? "active",
      limit: input.limit ?? 50,
      before: input.before,
    })
    return projects.map((project) => ({
      ...project,
      displayTitle: getProjectDisplayTitle(project),
    }))
  }

  async projectBootstrap(input: {
    actorId: string
    projectId: string
  }): Promise<ProjectBootstrap> {
    const repositories = createThreadChatRepositories(this.sql)
    const project = await repositories.projects.findOwnedById(
      input.actorId,
      input.projectId
    )
    invariant(project, "entity_not_found", "Project 不存在。")
    const threadTopology = await repositories.threads.listOwnedTopology(
      input.actorId,
      input.projectId
    )
    const root = threadTopology.find((thread) => thread.parentThreadId === null)
    invariant(root, "project_root_invalid", "Project 缺少唯一 Root Thread。")
    const artifactSummary = await repositories.artifacts.summarizeOwnedProject(
      input.actorId,
      input.projectId
    )
    invariant(artifactSummary, "entity_not_found", "Project 不存在。")
    return {
      project,
      threadTopology,
      artifactSummary,
      initialThread: await this.threadMessages({
        actorId: input.actorId,
        threadId: root.id,
      }),
    }
  }

  async threadMessages(input: {
    actorId: string
    threadId: string
    limit?: number
    beforeSequence?: number
  }): Promise<ThreadMessageBundle> {
    const repositories = createThreadChatRepositories(this.sql)
    const thread = await repositories.threads.findOwnedById(
      input.actorId,
      input.threadId
    )
    invariant(thread, "entity_not_found", "Thread 不存在。")
    const limit = input.limit ?? 200
    const fetched = await repositories.messages.listEffectiveWindow({
      actorId: input.actorId,
      threadId: input.threadId,
      beforeSequence: input.beforeSequence,
      limit: limit + 1,
    })
    const hasOlderMessages = fetched.length > limit
    const messages = hasOlderMessages ? fetched.slice(1) : fetched
    const assistantMessageIds = messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.id)
    const assistantRuns =
      await repositories.messageRuns.findOwnedByAssistantMessageIds(
        input.actorId,
        assistantMessageIds
      )
    invariant(
      assistantRuns.length === assistantMessageIds.length,
      "entity_not_found",
      "assistant Message 缺少唯一 MessageRun。"
    )
    return {
      threadId: input.threadId,
      messages,
      assistantRuns,
      hasOlderMessages,
      oldestReturnedSequence: messages[0]?.sequence ?? null,
      newestReturnedSequence: messages.at(-1)?.sequence ?? null,
    }
  }

  async artifactById(input: { actorId: string; artifactId: string }) {
    const artifact = await createThreadChatRepositories(
      this.sql
    ).artifacts.findOwnedById(input.actorId, input.artifactId)
    invariant(artifact, "entity_not_found", "Artifact 不存在。")
    return artifact
  }
}
