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
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"

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

/** Composer 草稿到网络命令的唯一转换，保持最终 parts 原序。 */
export function composerDraftToMessageContent(
  draft: ThreadComposerDraft
): MessageContentInput {
  return messageContentInputSchema.parse({
    parts: normalizeMessageContentParts(draft.parts.map(({ localId, ...part }) => {
      void localId
      if (part.type === "upload") throw new Error("附件尚未上传完成，请等待或移除附件")
      return part
    })),
  })
}

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

/** 已保存用户内容恢复为完整草稿，位置由原数组决定。 */
export function messagePartsToComposerDraft(parts: ThreadChatUIMessage["parts"], createId: () => string = () => crypto.randomUUID()): ThreadComposerDraft {
  return { parts: parts.map((part) => {
    const localId = createId()
    switch (part.type) {
      case "text": return { localId, type: "text" as const, text: part.text }
      case "file": return { localId, type: "file" as const, file: fileReferenceSchema.parse({ url: part.url, mediaType: part.mediaType, ...(part.filename ? { filename: part.filename } : {}) }) }
      case "data-artifact-reference": return { localId, type: "artifact-reference" as const, artifactId: artifactReferenceDataSchema.parse(part.data).artifactId }
      case "data-quote": {
        const quote = persistedThreadQuotePartSchema.parse(part).data
        return { localId, type: "quote" as const, quote }
      }
      default: throw new Error(`用户消息包含不支持的内容类型：${part.type}`)
    }
  }) }
}

export function messagePartsToContent(parts: ThreadChatUIMessage["parts"]): MessageContentInput {
  return composerDraftToMessageContent(messagePartsToComposerDraft(parts))
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
