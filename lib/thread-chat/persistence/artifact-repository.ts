import { and, desc, eq, inArray } from "drizzle-orm"
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

/** 调用方先校验 Project 所有权；返回来源状态，由应用层决定新引用规则。 */
export async function loadProjectReferenceArtifactRows(
  executor: ConversationExecutor,
  projectId: string,
  ids: readonly string[]
) {
  if (!ids.length) return []
  return withSource(executor).where(and(
    eq(artifacts.projectId, projectId),
    inArray(artifacts.id, [...new Set(ids)])
  ))
}
