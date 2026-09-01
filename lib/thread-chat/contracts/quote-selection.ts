import { z } from "zod"
import {
  THREAD_QUOTE_MAX_COMMENT_CHARACTERS,
  THREAD_QUOTE_MAX_COUNT,
  THREAD_QUOTE_MAX_TEXT_CHARACTERS,
} from "@/constants/thread-chat-quote"

export const textAnchorSchema = z
  .object({
    quote: z
      .object({
        exact: z.string().min(1).max(THREAD_QUOTE_MAX_TEXT_CHARACTERS),
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

const messageSelectionSourceSchema = z
  .object({
    type: z.literal("message-selection"),
    sourceMessageId: z.uuid(),
    anchor: textAnchorSchema,
  })
  .strict()

const artifactSelectionSourceSchema = z
  .object({
    type: z.literal("artifact-selection"),
    artifactId: z.uuid(),
    anchor: textAnchorSchema,
  })
  .strict()

export const quoteSourceInputSchema = z.discriminatedUnion("type", [
  messageSelectionSourceSchema,
  artifactSelectionSourceSchema,
])

export const quoteSelectionInputSchema = z
  .object({
    source: quoteSourceInputSchema,
    comment: z
      .string()
      .trim()
      .min(1)
      .max(THREAD_QUOTE_MAX_COMMENT_CHARACTERS)
      .optional(),
  })
  .strict()

export const quoteSelectionListSchema = z
  .array(quoteSelectionInputSchema)
  .max(THREAD_QUOTE_MAX_COUNT)
  .default([])

export type MessageSelectionInput = z.infer<
  typeof messageSelectionSourceSchema
>
export type ArtifactSelectionInput = z.infer<
  typeof artifactSelectionSourceSchema
>
export type QuoteSourceInput = z.infer<typeof quoteSourceInputSchema>
export type QuoteSelectionInput = z.infer<typeof quoteSelectionInputSchema>
