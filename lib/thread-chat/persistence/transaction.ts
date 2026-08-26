import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { projects, threads } from "@/lib/db/schema"

export type ConversationTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]
export type ConversationExecutor = typeof db | ConversationTransaction

export function withConversationTransaction<T>(
  execute: (tx: ConversationTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(execute)
}

export async function allocateThreadSequences(
  tx: ConversationTransaction,
  threadId: string,
  count: 1 | 2
): Promise<number[]> {
  const [updated] = await tx
    .update(threads)
    .set({
      nextSequence: sql`${threads.nextSequence} + ${count}`,
      updatedAt: new Date(),
    })
    .where(eq(threads.id, threadId))
    .returning({ nextSequence: threads.nextSequence })
  if (!updated) throw new Error("THREAD_NOT_FOUND")
  const first = updated.nextSequence - count
  return Array.from({ length: count }, (_, index) => first + index)
}

export async function allocateProjectFootnote(
  tx: ConversationTransaction,
  projectId: string
): Promise<number> {
  const [updated] = await tx
    .update(projects)
    .set({
      nextFootnote: sql`${projects.nextFootnote} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning({ nextFootnote: projects.nextFootnote })
  if (!updated) throw new Error("PROJECT_NOT_FOUND")
  return updated.nextFootnote - 1
}
