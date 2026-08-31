import { z } from "zod"
import {
  THREAD_MESSAGE_MAX_FILES,
  THREAD_MESSAGE_MAX_TEXT_CHARS,
  THREAD_QUOTE_MAX_COUNT,
} from "@/constants/thread-chat"
import {
  quoteSelectionInputSchema,
  textAnchorSchema,
} from "@/lib/thread-chat/domain/thread-quote"

const entityIdSchema = z.uuid()
const commandIdSchema = z.uuid()
const modelIdSchema = z.string().trim().min(1).max(160)
const requiredMessageTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(THREAD_MESSAGE_MAX_TEXT_CHARS)
const editableMessageTextSchema = z
  .string()
  .max(THREAD_MESSAGE_MAX_TEXT_CHARS)

const fileReferenceSchema = z
  .object({
    url: z.string().min(1),
    mediaType: z.string().trim().min(1).max(160),
    filename: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

const filesSchema = z
  .array(fileReferenceSchema)
  .max(THREAD_MESSAGE_MAX_FILES)
  .default([])

const requiredMessageContentFields = {
  text: requiredMessageTextSchema,
  files: filesSchema,
} as const

export const startProjectCommandSchema = z
  .object({
    commandId: commandIdSchema,
    projectId: entityIdSchema,
    rootThreadId: entityIdSchema,
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    modelId: modelIdSchema,
    ...requiredMessageContentFields,
  })
  .strict()

export const sendMessageCommandSchema = z
  .object({
    commandId: commandIdSchema,
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    modelId: modelIdSchema,
    text: editableMessageTextSchema.default(""),
    files: filesSchema,
    quotes: z
      .array(quoteSelectionInputSchema)
      .max(THREAD_QUOTE_MAX_COUNT)
      .default([]),
  })
  .strict()
  .refine(
    (command) =>
      command.text.trim().length > 0 ||
      command.quotes.some((quote) => Boolean(quote.comment?.trim())),
    {
      message: "请输入问题，或至少为一份引用添加评论",
      path: ["text"],
    }
  )

/**
 * Fork 直接带问只包含必填问题和附件。父 Thread 的 branch-origin Quote 由
 * 服务端从已验证 Fork 字段生成；v1 不允许借 firstTurn 夹带任意跨 Thread Quote。
 */
const firstForkTurnSchema = z
  .object({
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    text: requiredMessageTextSchema,
    files: filesSchema,
  })
  .strict()

export const forkThreadCommandSchema = z
  .object({
    commandId: commandIdSchema,
    threadId: entityIdSchema,
    sourceMessageId: entityIdSchema,
    anchorText: z.string().trim().min(1).max(20_000),
    anchor: textAnchorSchema,
    modelId: modelIdSchema,
    firstTurn: firstForkTurnSchema.optional(),
  })
  .strict()

export const editLatestTurnCommandSchema = z
  .object({
    commandId: commandIdSchema,
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    modelId: modelIdSchema,
    text: editableMessageTextSchema,
    files: filesSchema,
  })
  .strict()

export const retryMessageCommandSchema = z
  .object({
    commandId: commandIdSchema,
    assistantMessageId: entityIdSchema,
    modelId: modelIdSchema,
  })
  .strict()

export const stopMessageCommandSchema = z
  .object({ commandId: commandIdSchema })
  .strict()

export const setFeedbackCommandSchema = z
  .object({
    commandId: commandIdSchema,
    feedback: z.enum(["up", "down"]).nullable(),
  })
  .strict()

export const renameProjectCommandSchema = z
  .object({
    commandId: commandIdSchema,
    customTitle: z.string().trim().min(1).max(60),
  })
  .strict()

export const setProjectArchivedCommandSchema = z
  .object({
    commandId: commandIdSchema,
    archived: z.boolean(),
  })
  .strict()

export const deleteProjectCommandSchema = z
  .object({ commandId: commandIdSchema })
  .strict()

export const updateThreadCommandSchema = z
  .object({
    commandId: commandIdSchema,
    modelId: modelIdSchema.optional(),
    customTitle: z.string().trim().min(1).max(60).nullable().optional(),
  })
  .strict()
  .refine(
    (command) =>
      command.modelId !== undefined || command.customTitle !== undefined,
    { message: "至少提供 modelId 或 customTitle" }
  )

export type StartProjectCommand = z.infer<typeof startProjectCommandSchema>
type ParsedSendMessageCommand = z.infer<typeof sendMessageCommandSchema>
export type SendMessageCommand = Omit<
  ParsedSendMessageCommand,
  "quotes"
> & {
  /** 兼容尚未接入 Quote Composer 的客户端；服务端 Schema 会补空数组。 */
  quotes?: ParsedSendMessageCommand["quotes"]
}
export type ForkThreadCommand = z.infer<typeof forkThreadCommandSchema>
export type EditLatestTurnCommand = z.infer<
  typeof editLatestTurnCommandSchema
>
export type RetryMessageCommand = z.infer<typeof retryMessageCommandSchema>
export type StopMessageCommand = z.infer<typeof stopMessageCommandSchema>
export type SetFeedbackCommand = z.infer<typeof setFeedbackCommandSchema>
export type RenameProjectCommand = z.infer<typeof renameProjectCommandSchema>
export type SetProjectArchivedCommand = z.infer<
  typeof setProjectArchivedCommandSchema
>
export type DeleteProjectCommand = z.infer<typeof deleteProjectCommandSchema>
export type UpdateThreadCommand = z.infer<typeof updateThreadCommandSchema>
