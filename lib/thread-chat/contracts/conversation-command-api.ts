import { z } from "zod"

import { CONVERSATION_COMMAND_SCHEMA_VERSION } from "../../../constants/conversation-command"

const entityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/\p{C}/u.test(value), "ID 不能包含控制字符")

const jsonValueSchema: z.ZodType<
  | string
  | number
  | boolean
  | null
  | readonly unknown[]
  | { readonly [key: string]: unknown }
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
)

export const messageContentTransportSchema = z.object({
  schemaVersion: z.literal(1),
  parts: z.array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }).strict(),
      z
        .object({
          type: z.literal("artifact-reference"),
          artifactId: entityIdSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("structured"),
          kind: z.string().min(1),
          value: jsonValueSchema,
        })
        .strict(),
    ])
  ),
})

export const createConversationRequestSchema = z
  .object({
    conversationId: entityIdSchema,
    rootThreadId: entityIdSchema,
    title: z.string().max(200).nullable().optional(),
    modelId: z.string().trim().min(1).max(200),
  })
  .strict()

export const conversationPatchRequestSchema = z.union([
  z.object({ title: z.string().min(1).max(200) }).strict(),
  z.object({ lifecycle: z.literal("archived") }).strict(),
])

export const threadPatchRequestSchema = conversationPatchRequestSchema

export const forkThreadRequestSchema = z
  .object({
    conversationId: entityIdSchema,
    forkId: entityIdSchema,
    childThreadId: entityIdSchema,
    sourceMessageId: entityIdSchema,
    modelId: z.string().trim().min(1).max(200),
    localTitle: z.string().max(200).nullable().optional(),
    anchor: z
      .object({
        quote: z
          .object({
            exact: z.string(),
            prefix: z.string(),
            suffix: z.string(),
          })
          .strict(),
        position: z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const sendTurnRequestSchema = z
  .object({
    conversationId: entityIdSchema,
    turnId: entityIdSchema,
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    generationId: entityIdSchema,
    content: messageContentTransportSchema,
    modelId: z.string().trim().min(1).max(200),
  })
  .strict()

export const editTurnInputRequestSchema = z
  .object({
    conversationId: entityIdSchema,
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    generationId: entityIdSchema,
    sourceUserMessageId: entityIdSchema,
    content: messageContentTransportSchema,
    modelId: z.string().trim().min(1).max(200),
  })
  .strict()

export const regenerateTurnRequestSchema = z
  .object({
    conversationId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    generationId: entityIdSchema,
    sourceAssistantMessageId: entityIdSchema,
    modelId: z.string().trim().min(1).max(200),
  })
  .strict()

export const selectTurnVariantRequestSchema = z
  .object({
    conversationId: entityIdSchema,
    messageId: entityIdSchema,
    role: z.enum(["user", "assistant"]),
  })
  .strict()

export const commandSuccessTransportSchema = z.object({
  schemaVersion: z.literal(CONVERSATION_COMMAND_SCHEMA_VERSION),
  data: jsonValueSchema,
  revisions: z.record(z.string(), z.number().int().nonnegative()),
  delta: z.object({
    upsert: z.record(z.string(), z.array(z.unknown())),
    remove: z.record(z.string(), z.array(entityIdSchema)),
    invalidate: z.array(z.string()),
  }),
  replayed: z.boolean(),
})

export const querySuccessTransportSchema = z.object({
  schemaVersion: z.literal(CONVERSATION_COMMAND_SCHEMA_VERSION),
  data: z.unknown(),
})

export const conversationErrorTransportSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
})
