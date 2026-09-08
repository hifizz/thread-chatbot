import type { AttachmentUploadResult } from "@/lib/attachments/upload"
import { COMPOSER_ATTACHMENT_COPY } from "@/constants/attachment"
import type { ThreadComposerDraft } from "./contracts/composer"

/** 文件选择器草稿随 Thread 保留，File 与进度仅驻留客户端，不进入消息协议。 */
export type ComposerAttachmentDraft = { id: string; file: File } & (
  | { status: "uploading"; progress: number }
  | { status: "ready"; uploaded: AttachmentUploadResult }
  | { status: "error"; error: string }
)

export function appendComposerAttachments(draft: ThreadComposerDraft, attachments: readonly ComposerAttachmentDraft[]): ThreadComposerDraft {
  return { parts: [...draft.parts, ...attachments.map((attachment) => {
    if (attachment.status !== "ready") throw new Error(COMPOSER_ATTACHMENT_COPY.blocked)
    return { localId: attachment.id, type: "file" as const, file: attachment.uploaded.reference }
  })] }
}

export function formatComposerAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
