import { and, asc, eq } from "drizzle-orm"
import { projects, threads } from "@/lib/db/schema"
import type {
  ConversationExecutor,
  ConversationTransaction,
} from "@/lib/thread-chat/persistence/transaction"

export async function findOwnedThread(
  executor: ConversationExecutor,
  userId: string,
  threadId: string
) {
  const [row] = await executor
    .select({ thread: threads })
    .from(threads)
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .where(and(eq(threads.id, threadId), eq(projects.userId, userId)))
    .limit(1)
  return row?.thread ?? null
}

export async function lockOwnedThread(
  tx: ConversationTransaction,
  userId: string,
  threadId: string
) {
  const [row] = await tx
    .select({ thread: threads })
    .from(threads)
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .where(and(eq(threads.id, threadId), eq(projects.userId, userId)))
    .limit(1)
    .for("update")
  return row?.thread ?? null
}

export function listProjectThreadRows(
  executor: ConversationExecutor,
  projectId: string
) {
  return executor
    .select()
    .from(threads)
    .where(eq(threads.projectId, projectId))
    .orderBy(asc(threads.depth), asc(threads.createdAt))
}
