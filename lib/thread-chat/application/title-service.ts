import { and, eq } from "drizzle-orm"
import { projects, threads } from "@/lib/db/schema"
import { isRootThread } from "@/lib/thread-chat/domain/root-thread"
import { findOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"
import { withConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

export function claimTitleGenerationAttempt(
  userId: string,
  threadId: string
): Promise<boolean> {
  return withConversationTransaction(async (tx) => {
    const thread = await findOwnedThread(tx, userId, threadId)
    if (!thread) return false
    const [claimed] = await tx
      .update(threads)
      .set({ titleGenerationAttempted: true, updatedAt: new Date() })
      .where(
        and(
          eq(threads.id, thread.id),
          eq(threads.titleGenerationAttempted, false)
        )
      )
      .returning({ id: threads.id })
    return Boolean(claimed)
  })
}

export function saveGeneratedTitle(
  userId: string,
  threadId: string,
  title: string
): Promise<boolean> {
  return withConversationTransaction(async (tx) => {
    const thread = await findOwnedThread(tx, userId, threadId)
    if (!thread || !thread.titleGenerationAttempted) return false
    const now = new Date()
    const [updated] = await tx
      .update(threads)
      .set({ autoTitle: title, titleGenerated: true, updatedAt: now })
      .where(and(eq(threads.id, thread.id), eq(threads.titleGenerated, false)))
      .returning({ id: threads.id })
    if (!updated) return false
    if (isRootThread(thread)) {
      await tx
        .update(projects)
        .set({ autoTitle: title, updatedAt: now })
        .where(eq(projects.id, thread.projectId))
    }
    return true
  })
}
