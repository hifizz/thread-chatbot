import { and, asc, eq } from "drizzle-orm"
import { lockOwnedProject } from "./project-repository"
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
  const owned = await findOwnedThread(tx, userId, threadId)
  if (!owned) return null
  // 会话命令会写 Project；入口即获取排他锁，禁止持有子级锁后升级。
  const project = await lockOwnedProject(tx, userId, owned.projectId)
  if (!project) return null
  const [thread] = await tx.select().from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.projectId, project.id)))
    .for("update")
  return thread ? { project, thread } : null
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
