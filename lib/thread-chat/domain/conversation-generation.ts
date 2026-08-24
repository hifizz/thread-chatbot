import { z } from "zod"

import { CONVERSATION_GENERATION_CHECKPOINT_SCHEMA_VERSION } from "../../../constants/conversation-generation"
import type {
  ArtifactId,
  JsonValue,
  MessageContent,
  MessageContentState,
} from "./conversation-model"

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
)

export const usageCompletenessSchema = z.enum([
  "complete",
  "partial",
  "unavailable",
])
export type UsageCompleteness = z.infer<typeof usageCompletenessSchema>

export const knownGenerationUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  paidStepCount: z.number().int().nonnegative(),
  reportedStepCount: z.number().int().nonnegative(),
})
export type KnownGenerationUsage = z.infer<typeof knownGenerationUsageSchema>

export const generationResearchActivitySchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  status: z.enum(["running", "complete", "error", "stopped"]),
  sources: z.array(
    z.object({
      url: z.string().min(1),
      title: z.string().optional(),
    })
  ),
  error: z.string().optional(),
})
export type GenerationResearchActivity = z.infer<
  typeof generationResearchActivitySchema
>

export const conversationGenerationCheckpointSchema = z.object({
  schemaVersion: z.literal(CONVERSATION_GENERATION_CHECKPOINT_SCHEMA_VERSION),
  body: z.string(),
  artifactIds: z.array(z.string().min(1)),
  researchPlan: jsonValueSchema.nullable(),
  researchActivities: z.array(generationResearchActivitySchema),
  contentState: z.enum([
    "pending",
    "streaming",
    "complete",
    "incomplete",
    "failed",
  ]),
  knownUsage: knownGenerationUsageSchema.nullable(),
})
export type ConversationGenerationCheckpoint = z.infer<
  typeof conversationGenerationCheckpointSchema
>

export function parseConversationGenerationCheckpoint(
  value: unknown
): ConversationGenerationCheckpoint {
  return conversationGenerationCheckpointSchema.parse(value)
}

export function emptyConversationGenerationCheckpoint(): ConversationGenerationCheckpoint {
  return {
    schemaVersion: CONVERSATION_GENERATION_CHECKPOINT_SCHEMA_VERSION,
    body: "",
    artifactIds: [],
    researchPlan: null,
    researchActivities: [],
    contentState: "pending",
    knownUsage: null,
  }
}

export function hasRecoverableCheckpointOutput(
  checkpoint: ConversationGenerationCheckpoint
): boolean {
  return (
    checkpoint.body.trim().length > 0 ||
    checkpoint.artifactIds.length > 0 ||
    checkpoint.researchActivities.length > 0 ||
    checkpoint.researchPlan !== null
  )
}

export function checkpointMessageContent(
  checkpoint: ConversationGenerationCheckpoint
): MessageContent {
  const parts: MessageContent["parts"][number][] = []
  if (checkpoint.body.length > 0)
    parts.push({ type: "text", text: checkpoint.body })
  for (const artifactId of checkpoint.artifactIds)
    parts.push({
      type: "artifact-reference",
      artifactId: artifactId as ArtifactId,
    })
  if (checkpoint.researchPlan !== null)
    parts.push({
      type: "structured",
      kind: "research-plan",
      value: checkpoint.researchPlan,
    })
  if (checkpoint.researchActivities.length > 0)
    parts.push({
      type: "structured",
      kind: "research-activities",
      value: jsonValueSchema.parse(checkpoint.researchActivities),
    })
  return { schemaVersion: 1, parts }
}

export function terminalMessageContentState(input: {
  readonly outcome: "completed" | "stopped" | "failed" | "superseded"
  readonly checkpoint: ConversationGenerationCheckpoint
}): MessageContentState {
  if (input.outcome === "completed") return "complete"
  if (hasRecoverableCheckpointOutput(input.checkpoint)) return "incomplete"
  return "failed"
}

export function aggregateKnownUsage(
  steps: readonly {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly paid: boolean
  }[]
): {
  readonly knownUsage: KnownGenerationUsage | null
  readonly completeness: UsageCompleteness
} {
  const paidSteps = steps.filter((step) => step.paid)
  if (paidSteps.length === 0)
    return { knownUsage: null, completeness: "unavailable" }
  const reported = paidSteps.filter(
    (step) =>
      Number.isInteger(step.inputTokens) &&
      Number.isInteger(step.outputTokens) &&
      (step.inputTokens ?? -1) >= 0 &&
      (step.outputTokens ?? -1) >= 0
  )
  const knownUsage =
    reported.length === 0
      ? null
      : {
          inputTokens: reported.reduce(
            (total, step) => total + (step.inputTokens ?? 0),
            0
          ),
          outputTokens: reported.reduce(
            (total, step) => total + (step.outputTokens ?? 0),
            0
          ),
          paidStepCount: paidSteps.length,
          reportedStepCount: reported.length,
        }
  return {
    knownUsage,
    completeness:
      reported.length === paidSteps.length
        ? "complete"
        : reported.length > 0
          ? "partial"
          : "unavailable",
  }
}

export function inferUsageCompleteness(
  knownUsage: KnownGenerationUsage | null
): UsageCompleteness {
  if (!knownUsage) return "unavailable"
  return knownUsage.reportedStepCount === knownUsage.paidStepCount
    ? "complete"
    : "partial"
}
