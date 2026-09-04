import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { PROJECT_TITLE_FALLBACK } from "@/constants/project-workspace"
import { projects, threads } from "@/lib/db/schema"
import type {
  ConversationExecutor,
  ConversationTransaction,
} from "@/lib/thread-chat/persistence/transaction"

export async function findOwnedProject(
  executor: ConversationExecutor,
  userId: string,
  projectId: string
) {
  const [row] = await executor
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function lockOwnedProject(
  tx: ConversationTransaction,
  userId: string,
  projectId: string
) {
  const [row] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
    .for("update")
  return row ?? null
}

export async function listOwnedProjectRows(
  executor: ConversationExecutor,
  userId: string,
  archived: boolean
) {
  return executor
    .select({
      id: projects.id,
      title: sql<string>`coalesce(${projects.customTitle}, ${projects.autoTitle}, ${PROJECT_TITLE_FALLBACK})`,
      updatedAt: projects.updatedAt,
      threadCount: count(threads.id).mapWith(Number),
    })
    .from(projects)
    .innerJoin(threads, eq(threads.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, userId),
        archived ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt)
      )
    )
    .groupBy(projects.id)
    .orderBy(desc(projects.updatedAt))
}

export async function findRootThreadId(
  executor: ConversationExecutor,
  projectId: string
): Promise<string | null> {
  const [row] = await executor
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.projectId, projectId), isNull(threads.parentId)))
    .limit(1)
  return row?.id ?? null
}
