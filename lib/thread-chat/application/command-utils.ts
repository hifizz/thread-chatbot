import { ModelCatalogError } from "@/lib/model-catalog/errors"
import { assertGenerationSettingsCapability, assertImageInputCapability } from "@/lib/model-catalog/validation"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { attachments, messages, projects, threads } from "@/lib/db/schema"
import {
  ATTACHMENT_URL_PREFIX,
  IMAGE_ATTACHMENT_MIME_TYPES,
} from "@/constants/attachment"

import type { GenerationSettings } from "@/constants/generation-settings"
import { requireCatalogModel } from "@/lib/model-catalog/lookup"
import type { ModelCatalog } from "@/lib/model-catalog/schema"

import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import {
  type FileReference,
} from "@/lib/thread-chat/contracts/message-content"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"
import { persistentMessageParts } from "@/lib/thread-chat/persistence/message-parts"
import {
  ConversationApplicationError,
  stateConflict,
} from "@/lib/thread-chat/application/errors"

export type { FileReference } from "@/lib/thread-chat/contracts/message-content"

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

export function assertAllowedModel(catalog: ModelCatalog, modelId: string): void {
  try { requireCatalogModel(catalog, modelId) } catch (error) {
    if (!(error instanceof ModelCatalogError) || error.status !== 400) throw error
    throw new ConversationApplicationError(
      "MODEL_NOT_ALLOWED",
      "当前模型不可用，请刷新页面并重新选择模型"
    )
  }
}

export function assertAllowedGenerationSettings(
  catalog: ModelCatalog,
  modelId: string,
  settings: GenerationSettings | undefined
): void {
  if (!settings) return
  const { config } = requireCatalogModel(catalog, modelId)
  assertGenerationSettingsCapability({ effortLevels: config.effortLevels, maxOutputTokenOptions: config.outputTokenOptions }, settings)
}

export function hasImageFileReferences(
  files: readonly FileReference[]
): boolean {
  return files.some((file) =>
    IMAGE_ATTACHMENT_MIME_TYPE_SET.has(file.mediaType)
  )
}

/** 必须在创建生成消息及进入付费模型调用前执行。 */
export function assertModelSupportsNewAttachments(
  catalog: ModelCatalog,
  modelId: string,
  files: readonly FileReference[]
): void {
  const imageCount = files.filter((file) =>
    IMAGE_ATTACHMENT_MIME_TYPE_SET.has(file.mediaType)
  ).length
  if (!imageCount) return
  const snapshot = requireCatalogModel(catalog, modelId)
  assertImageInputCapability(snapshot.config.imageInput, imageCount)
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
