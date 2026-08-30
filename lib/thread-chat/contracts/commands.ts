import { z } from "zod"
import {
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_TARGET_MAX_CHARS,
} from "@/constants/project-workspace"

const entityIdSchema = z.uuid()
const commandIdSchema = z.uuid()
const modelIdSchema = z.string().trim().min(1).max(160)
const messageTextSchema = z.string().trim().min(1).max(200_000)

const fileReferenceSchema = z
  .object({
    url: z.string().min(1),
    mediaType: z.string().trim().min(1).max(160),
    filename: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

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

const messageContentFields = {
  text: messageTextSchema,
  files: z.array(fileReferenceSchema).max(20).default([]),
} as const

export const startProjectCommandSchema = z
  .object({
    commandId: commandIdSchema,
    projectId: entityIdSchema,
    rootThreadId: entityIdSchema,
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    modelId: modelIdSchema,
    ...messageContentFields,
  })
  .strict()

export const sendMessageCommandSchema = z
  .object({
    commandId: commandIdSchema,
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    modelId: modelIdSchema,
    ...messageContentFields,
  })
  .strict()

const firstForkTurnSchema = z
  .object({
    userMessageId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    text: messageTextSchema,
    files: z.array(fileReferenceSchema).max(20).default([]),
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
    ...messageContentFields,
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

export const updateProjectContractCommandSchema = z
  .object({
    commandId: commandIdSchema,
    expectedContractVersion: z.number().int().min(0),
    target: z.string().max(PROJECT_TARGET_MAX_CHARS),
    instructions: z.string().max(PROJECT_INSTRUCTIONS_MAX_CHARS),
  })
  .strict()

export const addProjectFileCommandSchema = z
  .object({
    commandId: commandIdSchema,
    attachmentId: entityIdSchema,
  })
  .strict()

export const removeProjectFileCommandSchema = z
  .object({
    commandId: commandIdSchema,
    attachmentId: entityIdSchema,
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
export type SendMessageCommand = z.infer<typeof sendMessageCommandSchema>
export type ForkThreadCommand = z.infer<typeof forkThreadCommandSchema>
export type EditLatestTurnCommand = z.infer<
  typeof editLatestTurnCommandSchema
>
export type RetryMessageCommand = z.infer<typeof retryMessageCommandSchema>
export type StopMessageCommand = z.infer<typeof stopMessageCommandSchema>
export type SetFeedbackCommand = z.infer<typeof setFeedbackCommandSchema>
export type RenameProjectCommand = z.infer<typeof renameProjectCommandSchema>
export type UpdateProjectContractCommand = z.infer<
  typeof updateProjectContractCommandSchema
>
export type AddProjectFileCommand = z.infer<typeof addProjectFileCommandSchema>
export type RemoveProjectFileCommand = z.infer<
  typeof removeProjectFileCommandSchema
>
export type SetProjectArchivedCommand = z.infer<
  typeof setProjectArchivedCommandSchema
>
export type DeleteProjectCommand = z.infer<typeof deleteProjectCommandSchema>
export type UpdateThreadCommand = z.infer<typeof updateThreadCommandSchema>
