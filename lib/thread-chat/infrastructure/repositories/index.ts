import type postgres from "postgres"
import { ArtifactRepository } from "./artifact-repository"
import { FeedbackRepository } from "./feedback-repository"
import { MessageRepository } from "./message-repository"
import { MessageRunRepository } from "./message-run-repository"
import { ProjectRepository } from "./project-repository"
import { ThreadRepository } from "./thread-repository"
import type { ThreadChatSql } from "./database"

export type ThreadChatRepositories = ReturnType<
  typeof createThreadChatRepositories
>

export function createThreadChatRepositories(sql: ThreadChatSql) {
  return {
    projects: new ProjectRepository(sql),
    threads: new ThreadRepository(sql),
    messages: new MessageRepository(sql),
    messageRuns: new MessageRunRepository(sql),
    artifacts: new ArtifactRepository(sql),
    feedback: new FeedbackRepository(sql),
  }
}

export class ThreadChatUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}

  transaction<T>(
    callback: (repositories: ThreadChatRepositories) => Promise<T>
  ): Promise<T> {
    return this.sql.begin((transactionSql) =>
      callback(createThreadChatRepositories(transactionSql))
    ) as Promise<T>
  }
}

export { ArtifactRepository } from "./artifact-repository"
export { FeedbackRepository } from "./feedback-repository"
export { MessageRepository } from "./message-repository"
export { MessageRunRepository } from "./message-run-repository"
export { ProjectRepository } from "./project-repository"
export { ThreadRepository } from "./thread-repository"
