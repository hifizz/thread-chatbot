import { and, eq, inArray, isNull } from "drizzle-orm"
import { attachments, messages, projects, threads } from "@/lib/db/schema"
import { ATTACHMENT_URL_PREFIX } from "@/constants/attachment"
import { isThreadChatModelId } from "@/constants/model"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"
import { persistentMessageParts } from "@/lib/thread-chat/persistence/message-parts"
import {
  ConversationApplicationError,
  stateConflict,
} from "@/lib/thread-chat/application/errors"

export interface FileReference {
  url: string
  mediaType: string
  filename?: string
}

export function assertAllowedModel(modelId: string): void {
  if (!isThreadChatModelId(modelId)) {
    throw new ConversationApplicationError(
      "MODEL_NOT_ALLOWED",
      "当前模型不可用于 ThreadChat"
    )
  }
}

function attachmentIdFromUrl(url: string): string | null {
  if (!url.startsWith(ATTACHMENT_URL_PREFIX)) return null
  const id = url.slice(ATTACHMENT_URL_PREFIX.length)
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

export async function assertOwnedReadyAttachments(
  tx: ConversationTransaction,
  userId: string,
  files: readonly FileReference[]
): Promise<void> {
  if (files.length === 0) return
  const ids = files.map((file) => attachmentIdFromUrl(file.url))
  if (ids.some((id) => id === null)) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      "附件 URL 不合法"
    )
  }
  const rows = await tx
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.userId, userId),
        eq(attachments.status, "ready"),
        inArray(attachments.id, ids as string[])
      )
    )
  if (new Set(rows.map((row) => row.id)).size !== new Set(ids).size) {
    throw new ConversationApplicationError("NOT_FOUND", "附件不存在")
  }
}

export function buildUserParts(
  text: string,
  files: readonly FileReference[]
): ThreadChatUIMessage["parts"] {
  return [
    { type: "text", text },
    ...files.map((file) => ({
      type: "file" as const,
      url: file.url,
      mediaType: file.mediaType,
      ...(file.filename ? { filename: file.filename } : {}),
    })),
  ]
}

export function stripTransientParts(
  parts: ThreadChatUIMessage["parts"]
): ThreadChatUIMessage["parts"] {
  return persistentMessageParts(parts)
}

export async function assertThreadReadyForTurn(
  tx: ConversationTransaction,
  projectId: string,
  threadId: string
): Promise<void> {
  const [active] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.projectId, projectId),
        eq(messages.threadId, threadId),
        eq(messages.status, "generating"),
        eq(messages.role, "assistant"),
        isNull(messages.supersededAt)
      )
    )
    .limit(1)
  if (active) stateConflict("当前 Thread 仍有回复正在生成")
}

export async function touchProjectAndThread(
  tx: ConversationTransaction,
  projectId: string,
  threadId: string,
  modelId?: string
): Promise<void> {
  const now = new Date()
  await tx
    .update(projects)
    .set({ updatedAt: now })
    .where(eq(projects.id, projectId))
  await tx
    .update(threads)
    .set({ updatedAt: now, ...(modelId ? { modelId } : {}) })
    .where(eq(threads.id, threadId))
}
