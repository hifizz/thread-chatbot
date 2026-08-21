import { z } from "zod"

import { CONVERSATION_COMMAND_SCHEMA_VERSION } from "../../../constants/conversation-command"
import { CONVERSATION_SNAPSHOT_SCHEMA_VERSION } from "../../../constants/conversation-domain"
import type {
  CommandSuccess,
  ConversationSnapshotResult,
} from "../application/conversation-command-contracts"
import type { CanonicalGenerationRecord } from "../application/conversation-generation-service"
import { conversationGenerationCheckpointSchema } from "../domain/conversation-generation"
import type { ConversationSnapshot } from "../domain/conversation-model"
import { assertValidConversationSnapshot } from "../domain/conversation-validation"

const id = z.string().trim().min(1).max(200)
const timestamp = z.string().min(1)
const lifecycle = z.enum(["active", "archived"])
const contentState = z.enum([
  "pending",
  "streaming",
  "complete",
  "incomplete",
  "failed",
])

export const conversationAuthorityStateSchema = z
  .object({
    authority: z.enum(["legacy", "canonical"]),
    schemaVersion: z.number().int().positive(),
    epoch: z.string().trim().min(1),
    maintenanceMode: z.enum(["off", "read-only"]),
  })
  .strict()

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
)

const textAnchorSchema = z
  .object({
    quote: z
      .object({ exact: z.string(), prefix: z.string(), suffix: z.string() })
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

const contentSchema = z
  .object({
    schemaVersion: z.literal(1),
    parts: z.array(
      z.union([
        z.object({ type: z.literal("text"), text: z.string() }).strict(),
        z
          .object({ type: z.literal("artifact-reference"), artifactId: id })
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
  .strict()

const projectSchema = z
  .object({
    id,
    workspaceId: id,
    title: z.string(),
    revision: z.number().int().nonnegative(),
    lifecycle,
  })
  .strict()

const conversationSchema = z
  .object({
    id,
    projectId: id,
    rootThreadId: id,
    autoTitle: z.string().nullable(),
    customTitle: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    lifecycle,
  })
  .strict()

const threadSchema = z
  .object({
    id,
    conversationId: id,
    modelId: z.string().min(1),
    localTitle: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    lifecycle,
  })
  .strict()

const threadForkSchema = z
  .object({
    id,
    conversationId: id,
    parentThreadId: id,
    sourceMessageId: id,
    childThreadId: id,
    anchor: textAnchorSchema.optional(),
    createdBy: z.string().min(1),
    createdAt: timestamp,
  })
  .strict()

const turnSchema = z
  .object({
    id,
    threadId: id,
    position: z.number().int().nonnegative(),
    activeUserMessageId: id,
    activeAssistantMessageId: id,
    revision: z.number().int().nonnegative(),
  })
  .strict()

const messageSchema = z
  .object({
    id,
    threadId: id,
    turnId: id,
    role: z.enum(["user", "assistant", "context"]),
    content: contentSchema,
    contentState,
    variantOfMessageId: id.optional(),
    createdAt: timestamp,
  })
  .strict()

const generationIntentSchema = z.union([
  z.object({ kind: z.literal("send") }).strict(),
  z
    .object({
      kind: z.literal("regenerate-assistant"),
      sourceAssistantMessageId: id,
    })
    .strict(),
  z.object({ kind: z.literal("edit-user"), sourceUserMessageId: id }).strict(),
  z.object({ kind: z.literal("retry") }).strict(),
])

const generationSummarySchema = z
  .object({
    id,
    threadId: id,
    turnId: id,
    inputMessageId: id,
    outputMessageId: id,
    intent: generationIntentSchema,
    status: z.enum([
      "running",
      "stop_requested",
      "completed",
      "stopped",
      "failed",
      "superseded",
    ]),
    billingStatus: z.enum([
      "pending",
      "settled",
      "usage_unavailable",
      "not_billable",
    ]),
    attempt: z.number().int().positive(),
    createdAt: timestamp,
  })
  .strict()

const knownUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    paidStepCount: z.number().int().nonnegative(),
    reportedStepCount: z.number().int().nonnegative(),
  })
  .strict()

export const canonicalGenerationRecordTransportSchema =
  generationSummarySchema.extend({
    ownerId: z.string().min(1),
    workspaceId: id,
    projectId: id,
    conversationId: id,
    requestHash: z.string().min(1),
    idempotencyKey: z.string().min(1),
    modelId: z.string().min(1),
    isCurrent: z.boolean(),
    contentState,
    checkpointVersion: z.number().int().nonnegative(),
    checkpoint: conversationGenerationCheckpointSchema,
    knownUsage: knownUsageSchema.nullable(),
    usageCompleteness: z.enum(["complete", "partial", "unavailable"]),
    paidCallStarted: z.boolean(),
    leaseOwner: z.string().nullable(),
    leaseVersion: z.number().int().nonnegative(),
    heartbeatAt: timestamp,
    stopRequestedAt: timestamp.nullable(),
    startedAt: timestamp,
    finishedAt: timestamp.nullable(),
    errorCode: z.string().nullable(),
  })

const artifactSchema = z
  .object({
    id,
    sourceThreadId: id,
    sourceMessageId: id,
    title: z.string(),
    kind: z.string(),
  })
  .strict()

const snapshotSchema = z
  .object({
    schemaVersion: z.literal(CONVERSATION_SNAPSHOT_SCHEMA_VERSION),
    project: projectSchema,
    conversation: conversationSchema,
    threads: z.record(z.string(), threadSchema),
    threadForks: z.record(z.string(), threadForkSchema),
    turns: z.record(z.string(), turnSchema),
    messages: z.record(z.string(), messageSchema),
    generations: z.record(z.string(), generationSummarySchema),
    artifactProvenance: z.record(z.string(), artifactSchema),
  })
  .strict()

export const conversationSnapshotResultTransportSchema = z
  .object({
    snapshot: snapshotSchema,
    generations: z.array(canonicalGenerationRecordTransportSchema),
    contextMessageIdsByThread: z.record(z.string(), z.array(id)),
  })
  .strict()

export const conversationQueryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(CONVERSATION_COMMAND_SCHEMA_VERSION),
    data: z.unknown(),
  })
  .strict()

export const conversationCommandEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(CONVERSATION_COMMAND_SCHEMA_VERSION),
    data: jsonValueSchema,
    revisions: z.record(z.string(), z.number().int().nonnegative()),
    delta: z
      .object({
        upsert: z.record(z.string(), z.array(z.unknown())),
        remove: z.record(z.string(), z.array(id)),
        invalidate: z.array(z.string()),
      })
      .strict(),
    replayed: z.boolean(),
  })
  .strict()

export const conversationErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string(),
        requestId: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict()

export function parseConversationSnapshotResult(
  value: unknown
): ConversationSnapshotResult {
  const parsed = conversationSnapshotResultTransportSchema.parse(value)
  const snapshot = parsed.snapshot as unknown as ConversationSnapshot
  assertValidConversationSnapshot(snapshot)
  return {
    snapshot,
    generations:
      parsed.generations as unknown as readonly CanonicalGenerationRecord[],
    contextMessageIdsByThread:
      parsed.contextMessageIdsByThread as unknown as ConversationSnapshotResult["contextMessageIdsByThread"],
  }
}

export function parseConversationSnapshotQuery(
  value: unknown
): ConversationSnapshotResult {
  const envelope = conversationQueryEnvelopeSchema.parse(value)
  return parseConversationSnapshotResult(envelope.data)
}

export function parseCommandSuccess(value: unknown): CommandSuccess {
  return conversationCommandEnvelopeSchema.parse(
    value
  ) as unknown as CommandSuccess
}

export function parseConversationQuery<T>(
  value: unknown,
  dataSchema: z.ZodType<T>
): T {
  const envelope = conversationQueryEnvelopeSchema.parse(value)
  return dataSchema.parse(envelope.data)
}

export const generationQueryDataSchema = z
  .object({
    generation: canonicalGenerationRecordTransportSchema,
    pollAfterMs: z.number().int().positive().nullable().optional(),
  })
  .strict()

export const conversationListQueryDataSchema = z
  .object({
    conversations: z.array(
      z
        .object({
          id,
          projectId: id,
          rootThreadId: id,
          title: z.string().nullable(),
          revision: z.number().int().nonnegative(),
          lifecycle,
          updatedAt: timestamp,
        })
        .strict()
    ),
  })
  .strict()
