import { and, asc, eq, inArray } from "drizzle-orm"
import { messages, projects } from "@/lib/db/schema"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

export async function findOwnedMessage(
  executor: ConversationExecutor,
  userId: string,
  messageId: string
) {
  const [row] = await executor
    .select({ message: messages })
    .from(messages)
    .innerJoin(projects, eq(projects.id, messages.projectId))
    .where(and(eq(messages.id, messageId), eq(projects.userId, userId)))
    .limit(1)
  return row?.message ?? null
}

export async function lockOwnedMessage(
  tx: ConversationTransaction,
  userId: string,
  messageId: string
) {
  const [row] = await tx
    .select({ message: messages })
    .from(messages)
    .innerJoin(projects, eq(projects.id, messages.projectId))
    .where(and(eq(messages.id, messageId), eq(projects.userId, userId)))
    .limit(1)
    .for("update")
  return row?.message ?? null
}

export function listProjectMessageRows(
  executor: ConversationExecutor,
  projectId: string
) {
  return executor
    .select()
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(asc(messages.threadId), asc(messages.sequence))
}

export function listThreadMessageRows(
  executor: ConversationExecutor,
  projectId: string,
  threadId: string
) {
  return executor
    .select()
    .from(messages)
    .where(
      and(eq(messages.projectId, projectId), eq(messages.threadId, threadId))
    )
    .orderBy(asc(messages.sequence))
}

export async function loadProjectMessagesByIds(
  executor: ConversationExecutor,
  projectId: string,
  messageIds: readonly string[]
) {
  if (messageIds.length === 0) return []
  return executor
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.projectId, projectId),
        inArray(messages.id, [...messageIds])
      )
    )
}
