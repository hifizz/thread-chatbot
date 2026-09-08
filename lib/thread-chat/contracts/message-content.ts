import { MESSAGE_ATTACHMENT_MAX_FILES } from "@/constants/attachment"
import { artifactReferenceInputSchema, artifactReferenceDataSchema, type ArtifactReferenceData } from "./artifact-reference"
import { z } from "zod"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import {
  THREAD_QUOTE_SCHEMA_VERSION,
  threadQuoteDataV1Schema,
  legacyThreadQuoteDataSchema,
  persistedThreadQuotePartSchema,
  type ThreadQuoteDataV1,
} from "@/lib/thread-chat/contracts/quote"

export type FileReference = z.infer<typeof fileReferenceSchema>

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
  artifactReferenceInputSchema,
  z.object({ type: z.literal("text"), text: z.string().max(200_000) }).strict(),
  z.object({ type: z.literal("file"), file: fileReferenceSchema }).strict(),
  z
    .object({ type: z.literal("quote"), quote: z.union([threadQuoteInputV1Schema, legacyThreadQuoteDataSchema]) })
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
    if (fileCount > MESSAGE_ATTACHMENT_MAX_FILES) {
      context.addIssue({
        code: "custom",
        path: ["parts"],
        message: `附件不能超过 ${MESSAGE_ATTACHMENT_MAX_FILES} 个`,
      })
    }
  })

export type MessageContentPartInput = z.infer<
  typeof messageContentPartInputSchema
>
export type MessageContentInput = z.infer<typeof messageContentInputSchema>

/** 网络命令到持久化 UI Message Parts 的唯一转换，禁止按类型重排。 */
export function messageContentToUiParts(
  content: MessageContentInput,
  resolveReference?: (id: string) => ArtifactReferenceData
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
    if (part.type === "quote") return { type: "data-quote" as const, data: part.quote }
    if (!resolveReference) throw new Error("Artifact 引用必须先解析权威快照")
    return { type: "data-artifact-reference" as const, data: artifactReferenceDataSchema.parse(resolveReference(part.artifactId)) }
  })
}

export function filesFromMessageContent(
  content: MessageContentInput
): FileReference[] {
  return content.parts.flatMap((part) =>
    part.type === "file" ? [part.file] : []
  )
}

/** 只合并相邻文字；不改变空格和非文字部分的顺序或次数。 */
export function normalizeMessageContentParts(parts: readonly MessageContentPartInput[]): MessageContentPartInput[] {
  const result: MessageContentPartInput[] = []
  for (const part of parts) {
    if (part.type === "text" && part.text.length === 0) continue
    const previous = result.at(-1)
    if (part.type === "text" && previous?.type === "text") {
      result[result.length - 1] = { type: "text", text: previous.text + part.text }
    } else result.push(part)
  }
  return result
}

/** 持久化用户消息直接还原为命令内容，不经过编辑器状态。 */
export function messagePartsToContent(parts: ThreadChatUIMessage["parts"]): MessageContentInput {
  return messageContentInputSchema.parse({ parts: normalizeMessageContentParts(parts.map((part): MessageContentPartInput => {
    switch (part.type) {
      case "text": return { type: "text", text: part.text }
      case "file": return { type: "file", file: { url: part.url, mediaType: part.mediaType, ...(part.filename ? { filename: part.filename } : {}) } }
      case "data-artifact-reference": return { type: "artifact-reference", artifactId: artifactReferenceDataSchema.parse(part.data).artifactId }
      case "data-quote": return { type: "quote", quote: persistedThreadQuotePartSchema.parse(part).data }
      default: throw new Error(`用户消息包含不支持的内容类型：${part.type}`)
    }
  })) })
}

/** 文字入口（如划选提问弹窗）也先产生完整内容，再调用命令。 */
export function textMessageContent(text: string, files: readonly FileReference[] = []): MessageContentInput {
  return messageContentInputSchema.parse({ parts: [{ type: "text", text }, ...files.map((file) => ({ type: "file", file }))] })
}

export function forkFirstTurnContent(input: { text: string; sourceMessageId: string; anchorText: string; anchor: import("../domain/text-anchor").TextAnchor }): MessageContentInput {
  return messageContentInputSchema.parse({ parts: [
    { type: "quote", quote: { schemaVersion: THREAD_QUOTE_SCHEMA_VERSION, text: input.anchorText, source: { type: "message", messageId: input.sourceMessageId, anchor: input.anchor } } },
    { type: "text", text: input.text },
  ] })
}
