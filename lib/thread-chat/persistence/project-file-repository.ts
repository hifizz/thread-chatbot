import { and, desc, eq } from "drizzle-orm"
import { attachments, projectFiles } from "@/lib/db/schema"
import type { ConversationExecutor } from "@/lib/thread-chat/persistence/transaction"

export function listProjectFileRows(
  executor: ConversationExecutor,
  projectId: string
) {
  return executor
    .select({
      projectId: projectFiles.projectId,
      addedAt: projectFiles.addedAt,
      attachment: attachments,
    })
    .from(projectFiles)
    .innerJoin(attachments, eq(attachments.id, projectFiles.attachmentId))
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(desc(projectFiles.addedAt))
}

export async function findOwnedAttachmentRow(
  executor: ConversationExecutor,
  userId: string,
  attachmentId: string
) {
  const [row] = await executor
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.userId, userId)
      )
    )
    .limit(1)
  return row ?? null
}

export async function findProjectFileMembershipByAttachment(
  executor: ConversationExecutor,
  attachmentId: string
) {
  const [row] = await executor
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.attachmentId, attachmentId))
    .limit(1)
  return row ?? null
}

export async function findProjectFileRow(
  executor: ConversationExecutor,
  projectId: string,
  attachmentId: string
) {
  const [row] = await executor
    .select({
      projectId: projectFiles.projectId,
      addedAt: projectFiles.addedAt,
      attachment: attachments,
    })
    .from(projectFiles)
    .innerJoin(attachments, eq(attachments.id, projectFiles.attachmentId))
    .where(
      and(
        eq(projectFiles.projectId, projectId),
        eq(projectFiles.attachmentId, attachmentId)
      )
    )
    .limit(1)
  return row ?? null
}
