import {
  IMAGE_ATTACHMENT_MIME_TYPES,
  INLINE_PASTED_TEXT_CHAR_LIMIT,
  TEXT_ATTACHMENT_FILE_EXTENSIONS,
} from "@/constants/attachment"
import {
  isTextAttachmentFile,
} from "@/lib/attachments/upload"

export const THREAD_COMPOSER_MIME_TYPES = [
  "text/plain",
  ...IMAGE_ATTACHMENT_MIME_TYPES,
] as const

export const THREAD_COMPOSER_ACCEPT = [
  ...THREAD_COMPOSER_MIME_TYPES,
  ...TEXT_ATTACHMENT_FILE_EXTENSIONS,
].join(",")

export function isThreadComposerImageFile(
  file: Pick<File, "type">
): boolean {
  return (IMAGE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)
}

export function isThreadComposerFile(file: File): boolean {
  return isTextAttachmentFile(file) || isThreadComposerImageFile(file)
}

export function shouldInlinePastedText(text: string): boolean {
  return text.length <= INLINE_PASTED_TEXT_CHAR_LIMIT
}

export function createPastedTextFile(
  text: string,
  now: number = Date.now()
): File {
  return new File([text], `pasted-text-${now}.txt`, {
    type: "text/plain",
  })
}
