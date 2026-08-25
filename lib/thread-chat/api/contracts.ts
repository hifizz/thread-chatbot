import { z } from "zod"

export const idSchema = z.uuid()
export const dateTimeSchema = z.iso.datetime({ offset: true })
export const jsonValueSchema = z.json()

const textPartSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
})
const filePartSchema = z.strictObject({
  type: z.literal("file"),
  mediaType: z.string().min(1),
  filename: z.string().optional(),
  url: z.string().min(1),
})

export const userMessagePartsSchema = z
  .array(z.discriminatedUnion("type", [textPartSchema, filePartSchema]))
  .min(1)
  .refine(
    (parts) =>
      parts.some(
        (part) =>
          (part.type === "text" && part.text.trim().length > 0) ||
          part.type === "file"
      ),
    "Message parts must contain meaningful content."
  )

export const messagePartsSchema = z.array(
  z.looseObject({ type: z.string().min(1) })
)
export const markdownArtifactToolOutputSchema = z.strictObject({
  artifactId: idSchema,
})

export const projectTargetSchema = z.strictObject({
  ultimate: z.string().max(4_000).nullable(),
  shortTerm: z.array(z.string().trim().min(1).max(500)).max(50),
  midTerm: z.array(z.string().trim().min(1).max(500)).max(50),
})

export const projectSchema = z.strictObject({
  id: idSchema,
  ownerUserId: z.string().min(1),
  autoTitle: z.string().nullable(),
  customTitle: z.string().nullable(),
  target: projectTargetSchema.nullable(),
  instruction: z.string().nullable(),
  archivedAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
})

export const projectSummarySchema = z.strictObject({
  id: idSchema,
  displayTitle: z.string(),
  archivedAt: dateTimeSchema.nullable(),
  updatedAt: dateTimeSchema,
  threadCount: z.int().nonnegative(),
  messageCount: z.int().nonnegative(),
})

export const forkSourceSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  quote: z.string().optional(),
  sourceRole: z.enum(["user", "assistant"]),
  sourceSequence: z.int().positive(),
})

export const threadSchema = z
  .strictObject({
    id: idSchema,
    projectId: idSchema,
    parentThreadId: idSchema.nullable(),
    sourceMessageId: idSchema.nullable(),
    forkSourceSnapshot: forkSourceSnapshotSchema.nullable(),
    autoTitle: z.string().nullable(),
    customTitle: z.string().nullable(),
    archivedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .superRefine((thread, context) => {
    const rootFactsValid =
      thread.parentThreadId === null &&
      thread.sourceMessageId === null &&
      thread.forkSourceSnapshot === null
    const branchFactsValid =
      thread.parentThreadId !== null &&
      thread.sourceMessageId !== null &&
      thread.forkSourceSnapshot !== null
    if (!rootFactsValid && !branchFactsValid)
      context.addIssue({
        code: "custom",
        message: "Thread ForkFacts are inconsistent.",
      })
  })

export const messageSchema = z.strictObject({
  id: idSchema,
  threadId: idSchema,
  sequence: z.int().positive(),
  role: z.enum(["user", "assistant"]),
  parts: messagePartsSchema.nullable(),
  replacesMessageId: idSchema.nullable(),
  supersededAt: dateTimeSchema.nullable(),
  finalizedAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
})

export const assistantRunStateSchema = z.strictObject({
  assistantMessageId: idSchema,
  status: z.enum(["queued", "running", "completed", "failed", "stopped"]),
  modelId: z.string().min(1),
  checkpointParts: messagePartsSchema,
  eventSequence: z.int().nonnegative(),
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
  stopRequestedAt: dateTimeSchema.nullable(),
  finishedAt: dateTimeSchema.nullable(),
})

export const artifactSchema = z.strictObject({
  id: idSchema,
  projectId: idSchema,
  sourceMessageId: idSchema,
  kind: z.string(),
  title: z.string(),
  content: jsonValueSchema,
  createdAt: dateTimeSchema,
})

export const artifactSummarySchema = z
  .strictObject({
    changeSequence: z.int().nonnegative(),
    total: z.int().nonnegative(),
    byKind: z.record(z.string(), z.int().nonnegative()),
  })
  .refine(
    (summary) =>
      Object.values(summary.byKind).reduce((sum, count) => sum + count, 0) ===
      summary.total,
    "Artifact summary total must equal byKind counts."
  )

export const feedbackSchema = z.strictObject({
  messageId: idSchema,
  value: z.enum(["positive", "negative"]).nullable(),
  updatedAt: dateTimeSchema,
})

export const threadMessageBundleSchema = z
  .strictObject({
    threadId: idSchema,
    messages: z.array(messageSchema),
    assistantRuns: z.array(assistantRunStateSchema),
    hasOlderMessages: z.boolean(),
    oldestReturnedSequence: z.int().positive().nullable(),
    newestReturnedSequence: z.int().positive().nullable(),
  })
  .superRefine((bundle, context) => {
    if (bundle.messages.some((message) => message.threadId !== bundle.threadId))
      context.addIssue({
        code: "custom",
        message: "Message belongs to another Thread.",
      })
    const assistantIds = bundle.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.id)
      .toSorted()
    const runIds = bundle.assistantRuns
      .map((run) => run.assistantMessageId)
      .toSorted()
    if (JSON.stringify(assistantIds) !== JSON.stringify(runIds))
      context.addIssue({
        code: "custom",
        message: "Assistant Run coverage is invalid.",
      })
  })

export const projectBootstrapSchema = z
  .strictObject({
    project: projectSchema,
    threadTopology: z.array(threadSchema),
    artifactSummary: artifactSummarySchema,
    initialThread: threadMessageBundleSchema,
  })
  .superRefine((bootstrap, context) => {
    const roots = bootstrap.threadTopology.filter(
      (thread) => thread.parentThreadId === null
    )
    if (
      roots.length !== 1 ||
      roots[0].id !== bootstrap.initialThread.threadId ||
      bootstrap.threadTopology.some(
        (thread) => thread.projectId !== bootstrap.project.id
      )
    )
      context.addIssue({
        code: "custom",
        message: "Project Bootstrap ownership is invalid.",
      })
  })

export const creationBundleSchema = z
  .strictObject({
    project: projectSchema,
    rootThread: threadSchema,
    artifactSummary: artifactSummarySchema,
    userMessage: messageSchema,
    assistantMessage: messageSchema,
    assistantRun: assistantRunStateSchema,
  })
  .superRefine((bundle, context) => {
    if (
      bundle.rootThread.projectId !== bundle.project.id ||
      bundle.rootThread.parentThreadId !== null ||
      bundle.userMessage.threadId !== bundle.rootThread.id ||
      bundle.assistantMessage.threadId !== bundle.rootThread.id ||
      bundle.assistantRun.assistantMessageId !== bundle.assistantMessage.id
    )
      context.addIssue({
        code: "custom",
        message: "Creation Bundle ownership is invalid.",
      })
  })

export const messageCreationBundleSchema = z
  .strictObject({
    userMessage: messageSchema,
    assistantMessage: messageSchema,
    assistantRun: assistantRunStateSchema,
  })
  .superRefine((bundle, context) => {
    if (
      bundle.userMessage.threadId !== bundle.assistantMessage.threadId ||
      bundle.assistantRun.assistantMessageId !== bundle.assistantMessage.id
    )
      context.addIssue({
        code: "custom",
        message: "Message Bundle ownership is invalid.",
      })
  })

export const replacementBundleSchema = z.strictObject({
  supersededMessageIds: z.array(idSchema),
  createdMessages: z.array(messageSchema),
  assistantRun: assistantRunStateSchema,
})

export const listProjectsResultSchema = z.strictObject({
  items: z.array(projectSummarySchema),
  nextCursor: z.string().nullable(),
})

export const listProjectsQuerySchema = z.strictObject({
  status: z.enum(["active", "archived", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
})
export const threadMessagesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(200),
  beforeSequence: z.coerce.number().int().positive().optional(),
})
export const assistantEventsQuerySchema = z.strictObject({
  afterEventSequence: z.coerce.number().int().nonnegative().default(0),
})

export const createProjectRequestSchema = z.strictObject({
  initialMessage: z.strictObject({ parts: userMessagePartsSchema }),
  requestedModelId: z.string().min(1).optional(),
})
export const sendMessageRequestSchema = z.strictObject({
  parts: userMessagePartsSchema,
  requestedModelId: z.string().min(1).optional(),
})
export const patchProjectRequestSchema = z
  .strictObject({
    customTitle: z.string().trim().min(1).max(120).nullable().optional(),
    target: projectTargetSchema.nullable().optional(),
    instruction: z.string().max(20_000).nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required."
  )
export const patchThreadRequestSchema = z.strictObject({
  customTitle: z.string().trim().min(1).max(120).nullable(),
})
export const forkThreadRequestSchema = z.strictObject({
  sourceMessageId: idSchema,
  anchor: z
    .strictObject({
      exactQuote: z.string().min(1),
      textPosition: z
        .strictObject({
          start: z.int().nonnegative(),
          end: z.int().positive(),
        })
        .refine((position) => position.end > position.start)
        .optional(),
    })
    .optional(),
})
export const editMessageRequestSchema = sendMessageRequestSchema
export const regenerateMessageRequestSchema = z.strictObject({
  requestedModelId: z.string().min(1).optional(),
})
export const putFeedbackRequestSchema = z.strictObject({
  value: z.enum(["positive", "negative"]).nullable(),
})

export const apiErrorCodeSchema = z.enum([
  "validation_error",
  "invalid_query",
  "invalid_cursor",
  "invalid_event_cursor",
  "unauthorized",
  "forbidden",
  "project_not_found",
  "thread_not_found",
  "message_not_found",
  "assistant_message_not_found",
  "message_run_not_found",
  "artifact_not_found",
  "model_not_available",
  "thread_archived",
  "thread_generation_in_progress",
  "root_thread_title_owned_by_project",
  "root_thread_archive_owned_by_project",
  "source_message_not_found",
  "fork_source_thread_mismatch",
  "fork_source_not_finalized",
  "fork_source_superseded",
  "fork_anchor_mismatch",
  "message_not_editable",
  "message_not_regeneratable",
  "message_not_feedback_eligible",
  "fork_required",
  "project_delete_conflict",
  "internal_error",
])

export const apiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: jsonValueSchema.optional(),
  }),
})

const uiMessageChunkSchema = z.looseObject({ type: z.string().min(1) })
export const runSnapshotEventSchema = z.strictObject({
  type: z.literal("run.snapshot"),
  cursor: z.int().nonnegative(),
  run: assistantRunStateSchema,
  message: messageSchema,
  artifactSummary: artifactSummarySchema,
})
export const runDeltaEventSchema = z.strictObject({
  type: z.literal("run.delta"),
  eventSequence: z.int().nonnegative(),
  chunk: uiMessageChunkSchema,
})
export const runCompletedEventSchema = z.strictObject({
  type: z.literal("run.completed"),
  eventSequence: z.int().nonnegative(),
  run: assistantRunStateSchema,
  message: messageSchema,
  artifactSummary: artifactSummarySchema,
})
export const runFailedEventSchema = z.strictObject({
  type: z.literal("run.failed"),
  eventSequence: z.int().nonnegative(),
  run: assistantRunStateSchema,
})
export const runStoppedEventSchema = z.strictObject({
  type: z.literal("run.stopped"),
  eventSequence: z.int().nonnegative(),
  run: assistantRunStateSchema,
  message: messageSchema,
})
export const assistantMessageEventSchema = z.discriminatedUnion("type", [
  runSnapshotEventSchema,
  runDeltaEventSchema,
  runCompletedEventSchema,
  runFailedEventSchema,
  runStoppedEventSchema,
])

export type ProjectDTO = z.infer<typeof projectSchema>
export type ThreadDTO = z.infer<typeof threadSchema>
export type MessageDTO = z.infer<typeof messageSchema>
export type AssistantRunStateDTO = z.infer<typeof assistantRunStateSchema>
export type AssistantMessageEvent = z.infer<typeof assistantMessageEventSchema>
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type UserMessageParts = z.infer<typeof userMessagePartsSchema>
export function apiResponseSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data })
}
