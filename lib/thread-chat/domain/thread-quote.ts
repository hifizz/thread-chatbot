import { z } from "zod"
import {
  THREAD_QUOTE_MAX_COMMENT_CHARS,
  THREAD_QUOTE_MAX_TEXT_CHARS,
  THREAD_QUOTE_SCHEMA_VERSION,
} from "@/constants/thread-chat"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"

const entityIdSchema = z.uuid()

export const textAnchorSchema = z
  .object({
    quote: z
      .object({
        exact: z.string().min(1).max(THREAD_QUOTE_MAX_TEXT_CHARS),
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

export const messageSelectionInputSchema = z
  .object({
    type: z.literal("message-selection"),
    sourceMessageId: entityIdSchema,
    anchor: textAnchorSchema,
  })
  .strict()

export const artifactSelectionInputSchema = z
  .object({
    type: z.literal("artifact-selection"),
    artifactId: entityIdSchema,
    anchor: textAnchorSchema,
  })
  .strict()

export const quoteSourceInputSchema = z.discriminatedUnion("type", [
  messageSelectionInputSchema,
  artifactSelectionInputSchema,
])

const quoteCommentSchema = z
  .string()
  .trim()
  .min(1)
  .max(THREAD_QUOTE_MAX_COMMENT_CHARS)
  .optional()

export const quoteSelectionInputSchema = z
  .object({
    source: quoteSourceInputSchema,
    comment: quoteCommentSchema,
  })
  .strict()

const messageQuoteSourceSchema = z
  .object({
    type: z.literal("message-selection"),
    projectId: entityIdSchema,
    threadId: entityIdSchema,
    messageId: entityIdSchema,
    anchor: textAnchorSchema,
  })
  .strict()

const artifactQuoteSourceSchema = z
  .object({
    type: z.literal("artifact-selection"),
    projectId: entityIdSchema,
    threadId: entityIdSchema,
    sourceMessageId: entityIdSchema,
    artifactId: entityIdSchema,
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
    quoteId: entityIdSchema,
    kind: z.enum(["branch-origin", "selection"]),
    text: z.string().min(1).max(THREAD_QUOTE_MAX_TEXT_CHARS),
    comment: quoteCommentSchema,
    source: threadQuoteSourceV1Schema,
  })
  .strict()
  .superRefine((quote, context) => {
    if (quote.text !== quote.source.anchor.quote.exact) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Quote text 必须等于 source.anchor.quote.exact",
      })
    }
    if (
      quote.kind === "branch-origin" &&
      quote.source.type !== "message-selection"
    ) {
      context.addIssue({
        code: "custom",
        path: ["source", "type"],
        message: "branch-origin 只能来自 Message selection",
      })
    }
  })

export const legacyThreadQuoteDataSchema = z
  .object({
    text: z.string().min(1).max(THREAD_QUOTE_MAX_TEXT_CHARS),
  })
  .strict()

export type MessageSelectionInput = z.infer<
  typeof messageSelectionInputSchema
>
export type ArtifactSelectionInput = z.infer<
  typeof artifactSelectionInputSchema
>
export type QuoteSourceInput = z.infer<typeof quoteSourceInputSchema>
export type QuoteSelectionInput = z.infer<typeof quoteSelectionInputSchema>
export type MessageQuoteSourceV1 = z.infer<typeof messageQuoteSourceSchema>
export type ArtifactQuoteSourceV1 = z.infer<typeof artifactQuoteSourceSchema>
export type ThreadQuoteSourceV1 = z.infer<typeof threadQuoteSourceV1Schema>
export type ThreadQuoteDataV1 = z.infer<typeof threadQuoteDataV1Schema>
export type LegacyThreadQuoteData = z.infer<
  typeof legacyThreadQuoteDataSchema
>
export type ThreadQuoteData = ThreadQuoteDataV1 | LegacyThreadQuoteData
export type ThreadQuoteKind = ThreadQuoteDataV1["kind"]

export type NormalizedThreadQuote =
  | {
      schemaVersion: typeof THREAD_QUOTE_SCHEMA_VERSION
      quoteId: string
      kind: ThreadQuoteKind
      text: string
      comment?: string
      source: ThreadQuoteSourceV1
    }
  | {
      schemaVersion: "legacy"
      quoteId: null
      kind: "legacy"
      text: string
      source: null
    }

export function parseThreadQuoteData(value: unknown): NormalizedThreadQuote {
  const versioned = threadQuoteDataV1Schema.safeParse(value)
  if (versioned.success) return versioned.data

  const legacy = legacyThreadQuoteDataSchema.safeParse(value)
  if (legacy.success) {
    return {
      schemaVersion: "legacy",
      quoteId: null,
      kind: "legacy",
      text: legacy.data.text,
      source: null,
    }
  }

  throw new Error("INVALID_THREAD_QUOTE_DATA", { cause: versioned.error })
}

export function isThreadQuoteDataV1(
  value: unknown
): value is ThreadQuoteDataV1 {
  return threadQuoteDataV1Schema.safeParse(value).success
}

export function quoteSelectionKey(selection: QuoteSelectionInput): string {
  const source = selection.source
  const anchor = source.anchor
  const sourceId =
    source.type === "message-selection"
      ? `message:${source.sourceMessageId}`
      : `artifact:${source.artifactId}`
  return [
    sourceId,
    anchor.position?.start ?? "",
    anchor.position?.end ?? "",
    anchor.quote.exact,
    anchor.quote.prefix,
    anchor.quote.suffix,
  ].join("\u001f")
}

export function quoteSourceKey(source: ThreadQuoteSourceV1): string {
  const sourceId =
    source.type === "message-selection"
      ? `message:${source.messageId}`
      : `artifact:${source.artifactId}`
  const anchor = source.anchor
  return [
    sourceId,
    anchor.position?.start ?? "",
    anchor.position?.end ?? "",
    anchor.quote.exact,
    anchor.quote.prefix,
    anchor.quote.suffix,
  ].join("\u001f")
}

export function textAnchorExact(anchor: TextAnchor): string {
  return anchor.quote.exact
}
