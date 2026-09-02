import { and, desc, eq } from "drizzle-orm"
import { artifacts, messages, projects, threads } from "@/lib/db/schema"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"

const artifactSourceSelection = {
  artifact: artifacts,
  sourceThreadCustomTitle: threads.customTitle,
  sourceThreadAutoTitle: threads.autoTitle,
  sourceThreadFootnote: threads.footnote,
  sourceMessageStatus: messages.status,
}

function withSource(executor: ConversationExecutor) {
  return executor
    .select(artifactSourceSelection)
    .from(artifacts)
    .innerJoin(
      messages,
      and(
        eq(messages.id, artifacts.sourceMessageId),
        eq(messages.projectId, artifacts.projectId),
        eq(messages.threadId, artifacts.threadId)
      )
    )
    .innerJoin(
      threads,
      and(
        eq(threads.id, artifacts.threadId),
        eq(threads.projectId, artifacts.projectId)
      )
    )
}

export async function findOwnedArtifact(
  executor: ConversationExecutor,
  userId: string,
  artifactId: string
) {
  const [row] = await withSource(executor)
    .innerJoin(projects, eq(projects.id, artifacts.projectId))
    .where(and(eq(artifacts.id, artifactId), eq(projects.userId, userId)))
    .limit(1)
  return row ?? null
}

export function listProjectArtifactRows(
  executor: ConversationExecutor,
  projectId: string
) {
  return withSource(executor)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(desc(artifacts.createdAt))
}
