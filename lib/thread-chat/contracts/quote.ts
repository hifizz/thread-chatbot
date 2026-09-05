import { z } from "zod"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"

export const THREAD_QUOTE_SCHEMA_VERSION = "thread-quote-v1" as const

const textAnchorSchema = z
  .object({
    quote: z
      .object({
        exact: z.string().min(1),
        prefix: z.string(),
        suffix: z.string(),
      })
      .strict(),
    position: z
      .object({
        start: z.number().int().min(0),
        end: z.number().int().min(0),
      })
      .strict()
      .refine((position) => position.end > position.start, {
        message: "position.end 必须大于 position.start",
      })
      .optional(),
  })
  .strict()

const messageQuoteSourceSchema = z
  .object({
    type: z.literal("message"),
    messageId: z.uuid(),
    anchor: textAnchorSchema,
  })
  .strict()

const artifactQuoteSourceSchema = z
  .object({
    type: z.literal("artifact"),
    messageId: z.uuid(),
    artifactId: z.uuid(),
    anchor: textAnchorSchema,
  })
  .strict()

export const threadQuoteSourceV1Schema = z.discriminatedUnion("type", [
  messageQuoteSourceSchema,
  artifactQuoteSourceSchema,
])

export const threadQuoteDataV1Schema = z
  .object({
    schemaVersion: z.literal(THREAD_QUOTE_SCHEMA_VERSION),
    text: z.string().min(1).max(20_000),
    comment: z.string().trim().min(1).max(20_000).optional(),
    source: threadQuoteSourceV1Schema,
  })
  .strict()
  .superRefine((quote, context) => {
    if (quote.text !== quote.source.anchor.quote.exact) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Quote text 必须与 anchor.quote.exact 完全相等",
      })
    }
  })

export const threadQuotePartV1Schema = z
  .object({
    type: z.literal("data-quote"),
    data: threadQuoteDataV1Schema,
  })
  .strict()

export const legacyThreadQuoteDataSchema = z
  .object({ text: z.string().min(1).max(20_000) })
  .strict()

export const legacyThreadQuotePartSchema = z
  .object({
    type: z.literal("data-quote"),
    data: legacyThreadQuoteDataSchema,
  })
  .strict()

/** 旧 Quote 仅用于读取、保留、排序或删除，不得作为新命令输入。 */
export const persistedThreadQuotePartSchema = z.union([
  threadQuotePartV1Schema,
  legacyThreadQuotePartSchema,
])

export type ThreadQuoteSourceV1 = z.infer<typeof threadQuoteSourceV1Schema>
export type ThreadQuoteDataV1 = z.infer<typeof threadQuoteDataV1Schema>
export type ThreadQuotePartV1 = z.infer<typeof threadQuotePartV1Schema>
export type LegacyThreadQuoteData = z.infer<typeof legacyThreadQuoteDataSchema>
export type LegacyThreadQuotePart = z.infer<typeof legacyThreadQuotePartSchema>
export type ThreadChatQuoteData = ThreadQuoteDataV1 | LegacyThreadQuoteData

export interface ModelVisibleQuote {
  text: string
  comment?: string
}

/** Quote 的唯一模型投影：来源身份、Anchor 和客户端状态永不进入模型。 */
export function quoteForModel(quote: ThreadChatQuoteData): ModelVisibleQuote {
  return {
    text: quote.text,
    ...(typeof (quote as ThreadQuoteDataV1).comment === "string"
      ? { comment: (quote as ThreadQuoteDataV1).comment }
      : {}),
  }
}

/** 为客户端草稿复用的宽化来源类型。 */
export type ComposerQuoteSourceDraft =
  | { type: "message"; messageId: string; anchor: TextAnchor }
  | {
      type: "artifact"
      messageId: string
      artifactId: string
      anchor: TextAnchor
    }
