import {
  IMAGE_ATTACHMENT_MIME_TYPES,
  IMAGE_ATTACHMENT_LIMITS,
} from "@/constants/attachment"
import { supportsModelImageInput } from "@/constants/model"
import type { UploadedAttachmentReference } from "@/lib/chat/attachment-upload"

export const THREAD_COMPOSER_MIME_TYPES = [
  "text/plain",
  ...IMAGE_ATTACHMENT_MIME_TYPES,
] as const

export const THREAD_COMPOSER_ACCEPT = THREAD_COMPOSER_MIME_TYPES.join(",")

export function isThreadComposerFile(file: File): boolean {
  return (THREAD_COMPOSER_MIME_TYPES as readonly string[]).includes(file.type)
}

export type ThreadComposerAttachmentStatus = "uploading" | "ready" | "error"

export interface ThreadComposerAttachment {
  id: string
  file: File
  status: ThreadComposerAttachmentStatus
  progress: number
  error?: string
  serverId?: string
  reference?: UploadedAttachmentReference
}

export function createPastedTextFile(
  text: string,
  now: number = Date.now()
): File {
  return new File([text], `pasted-text-${now}.txt`, {
    type: "text/plain",
  })
}

export function canAddThreadImages(
  attachments: readonly ThreadComposerAttachment[],
  incomingCount: number
): boolean {
  const currentCount = attachments.filter((attachment) =>
    attachment.file.type.startsWith("image/")
  ).length
  return (
    currentCount + incomingCount <=
    IMAGE_ATTACHMENT_LIMITS.maxFilesPerMessage
  )
}

export function canSendThreadAttachments(
  attachments: readonly ThreadComposerAttachment[]
): boolean {
  return attachments.every((attachment) => attachment.status === "ready")
}

export function readyThreadAttachmentReferences(
  attachments: readonly ThreadComposerAttachment[]
): UploadedAttachmentReference[] {
  return attachments.flatMap((attachment) =>
    attachment.status === "ready" && attachment.reference
      ? [attachment.reference]
      : []
  )
}

export function hasUnsupportedReadyImages(
  modelId: string | undefined,
  attachments: readonly ThreadComposerAttachment[]
): boolean {
  return (
    !supportsModelImageInput(modelId) &&
    readyThreadAttachmentReferences(attachments).some((file) =>
      file.mediaType.startsWith("image/")
    )
  )
}
