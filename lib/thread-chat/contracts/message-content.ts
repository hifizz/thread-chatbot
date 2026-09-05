import { z } from "zod"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import {
  THREAD_QUOTE_SCHEMA_VERSION,
  threadQuoteDataV1Schema,
  type ThreadQuoteDataV1,
} from "@/lib/thread-chat/contracts/quote"
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"

export interface FileReference {
  url: string
  mediaType: string
  filename?: string
}

export const fileReferenceSchema = z
  .object({
    url: z.string().min(1),
    mediaType: z.string().trim().min(1).max(160),
    filename: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

export const threadQuoteInputV1Schema = threadQuoteDataV1Schema
export type ThreadQuoteInputV1 = ThreadQuoteDataV1

export const messageContentPartInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(200_000) }).strict(),
  z.object({ type: z.literal("file"), file: fileReferenceSchema }).strict(),
  z
    .object({ type: z.literal("quote"), quote: threadQuoteInputV1Schema })
    .strict(),
])

export const messageContentInputSchema = z
  .object({ parts: z.array(messageContentPartInputSchema).min(1).max(100) })
  .strict()
  .superRefine((content, context) => {
    const question = content.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
    if (!question) {
      context.addIssue({
        code: "custom",
        path: ["parts"],
        message: "至少需要一段非空总体问题文本",
      })
    }
    const fileCount = content.parts.filter(
      (part) => part.type === "file"
    ).length
    if (fileCount > 20) {
      context.addIssue({
        code: "custom",
        path: ["parts"],
        message: "附件不能超过 20 个",
      })
    }
  })

export type MessageContentPartInput = z.infer<
  typeof messageContentPartInputSchema
>
export type MessageContentInput = z.infer<typeof messageContentInputSchema>

/** Composer 草稿到网络命令的唯一转换，保持最终 parts 原序。 */
export function composerDraftToMessageContent(
  draft: ThreadComposerDraft
): MessageContentInput {
  return messageContentInputSchema.parse({
    parts: draft.parts.map((part) => {
      if (part.type === "text")
        return { type: "text" as const, text: part.text }
      if (part.type === "file")
        return { type: "file" as const, file: part.file }
      const comment = part.quote.comment.trim()
      return {
        type: "quote" as const,
        quote: {
          schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
          text: part.quote.text,
          ...(comment ? { comment } : {}),
          source: part.quote.source,
        },
      }
    }),
  })
}

/** 网络命令到持久化 UI Message Parts 的唯一转换，禁止按类型重排。 */
export function messageContentToUiParts(
  content: MessageContentInput
): ThreadChatUIMessage["parts"] {
  return content.parts.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text }
    if (part.type === "file") {
      return {
        type: "file" as const,
        url: part.file.url,
        mediaType: part.file.mediaType,
        ...(part.file.filename ? { filename: part.file.filename } : {}),
      }
    }
    return { type: "data-quote" as const, data: part.quote }
  })
}

export function filesFromMessageContent(
  content: MessageContentInput
): FileReference[] {
  return content.parts.flatMap((part) =>
    part.type === "file" ? [part.file] : []
  )
}
