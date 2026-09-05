import { and, eq, inArray, isNull } from "drizzle-orm"
import { attachments, messages, projects, threads } from "@/lib/db/schema"
import {
  ATTACHMENT_URL_PREFIX,
  IMAGE_ATTACHMENT_LIMITS,
  IMAGE_ATTACHMENT_MIME_TYPES,
  IMAGE_MODEL_VALIDATION_MESSAGE,
} from "@/constants/attachment"

import type { GenerationSettings } from "@/constants/generation-settings"
import {
  getModelGenerationSettingsCapability,
  isThreadChatModelId,
  supportsModelImageInput,
} from "@/constants/model"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"
import { persistentMessageParts } from "@/lib/thread-chat/persistence/message-parts"
import {
  ConversationApplicationError,
  stateConflict,
} from "@/lib/thread-chat/application/errors"

export const THREAD_MESSAGE_ATTACHMENT_MIME_TYPES = [
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const

const THREAD_MESSAGE_ATTACHMENT_MIME_TYPE_SET = new Set<string>(
  THREAD_MESSAGE_ATTACHMENT_MIME_TYPES
)

export { IMAGE_ATTACHMENT_MIME_TYPES }

const IMAGE_ATTACHMENT_MIME_TYPE_SET = new Set<string>(
  IMAGE_ATTACHMENT_MIME_TYPES
)

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

export function assertAllowedGenerationSettings(
  modelId: string,
  settings: GenerationSettings | undefined
): void {
  if (!settings) return
  const capability = getModelGenerationSettingsCapability(modelId)
  if (
    !capability ||
    !capability.effortLevels.includes(settings.effort) ||
    !capability.maxOutputTokenOptions.includes(settings.maxOutputTokens)
  ) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      "当前模型不支持所选生成参数"
    )
  }
}

export function hasImageFileReferences(
  files: readonly FileReference[]
): boolean {
  return files.some((file) => IMAGE_ATTACHMENT_MIME_TYPE_SET.has(file.mediaType))
}

/** 必须在创建生成消息及进入付费模型调用前执行。 */
export function assertModelSupportsNewAttachments(
  modelId: string,
  files: readonly FileReference[]
): void {
  const imageCount = files.filter((file) =>
    IMAGE_ATTACHMENT_MIME_TYPE_SET.has(file.mediaType)
  ).length
  if (imageCount > IMAGE_ATTACHMENT_LIMITS.maxFilesPerMessage) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      `单次最多添加 ${IMAGE_ATTACHMENT_LIMITS.maxFilesPerMessage} 张图片`
    )
  }
  if (imageCount > 0 && !supportsModelImageInput(modelId)) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      IMAGE_MODEL_VALIDATION_MESSAGE
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
  if (
    files.some(
      (file) => !THREAD_MESSAGE_ATTACHMENT_MIME_TYPE_SET.has(file.mediaType)
    )
  ) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      "附件类型不允许用于 Thread 消息"
    )
  }
  const rows = await tx
    .select({ id: attachments.id, mimeType: attachments.mimeType })
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
  const mimeTypeById = new Map(rows.map((row) => [row.id, row.mimeType]))
  if (
    files.some(
      (file, index) => mimeTypeById.get(ids[index] as string) !== file.mediaType
    )
  ) {
    throw new ConversationApplicationError(
      "VALIDATION_ERROR",
      "附件 mediaType 与服务端记录不一致"
    )
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
