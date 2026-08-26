import { and, asc, eq } from "drizzle-orm"
import { artifacts, projects } from "@/lib/db/schema"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"

export async function findOwnedArtifact(
  executor: ConversationExecutor,
  userId: string,
  artifactId: string
) {
  const [row] = await executor
    .select({ artifact: artifacts })
    .from(artifacts)
    .innerJoin(projects, eq(projects.id, artifacts.projectId))
    .where(and(eq(artifacts.id, artifactId), eq(projects.userId, userId)))
    .limit(1)
  return row?.artifact ?? null
}

export function listProjectArtifactRows(
  executor: ConversationExecutor,
  projectId: string
) {
  return executor
    .select()
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(asc(artifacts.createdAt))
}
