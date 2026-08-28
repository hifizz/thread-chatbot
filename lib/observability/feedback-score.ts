import type { MessageFeedback } from "@/lib/thread-chat/contracts/dto"
import {
  FEEDBACK_SCORE_SCHEMA_VERSION,
  FEEDBACK_SCORE_SOURCE,
  FEEDBACK_SCORE_VALUES,
  SCORE_NAMES,
} from "@/constants/observability"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import { classifyObservabilityError } from "@/lib/observability/error"
import {
  assistantMessageTraceId,
  feedbackScoreId,
} from "@/lib/observability/identity"

export type FeedbackScoreValue =
  (typeof FEEDBACK_SCORE_VALUES)[keyof typeof FEEDBACK_SCORE_VALUES]

export type FeedbackScoreBody = {
  id: string
  traceId: string
  name: string
  value: FeedbackScoreValue
  dataType: "CATEGORICAL"
  environment: string
  metadata: {
    source: string
    sourceEntity: "assistant-message"
    sourceUpdatedAt: string
    schemaVersion: string
  }
}

export type FeedbackScoreClient = {
  score: {
    create: (score: FeedbackScoreBody) => void
  }
  flush: () => Promise<void>
}

export type FeedbackMirrorInput = {
  messageId: string
  feedback: MessageFeedback | null
  updatedAt: string
}

export type FeedbackMirrorResult =
  | {
      status: "mirrored" | "queued"
      traceId: string
      scoreId: string
      value: FeedbackScoreValue
    }
  | {
      status: "skipped"
      reason: "langfuse-disabled"
    }
  | {
      status: "failed"
      errorCategory: string
    }

type FeedbackMirrorDependencies = {
  getClient?: () => Promise<FeedbackScoreClient | null>
  flush?: boolean
  timeoutMs?: number
}

let clientPromise: Promise<FeedbackScoreClient | null> | undefined

async function createDefaultClient(): Promise<FeedbackScoreClient | null> {
  const config = resolveObservabilityConfig()
  if (
    !config.langfuseEnabled ||
    !config.langfusePublicKey ||
    !config.langfuseSecretKey
  ) {
    return null
  }

  const { LangfuseClient } = await import("@langfuse/client")
  return new LangfuseClient({
    publicKey: config.langfusePublicKey,
    secretKey: config.langfuseSecretKey,
    ...(config.langfuseBaseUrl ? { baseUrl: config.langfuseBaseUrl } : {}),
  })
}

export function getFeedbackScoreClient(): Promise<FeedbackScoreClient | null> {
  clientPromise ??= createDefaultClient().catch((error: unknown) => {
    clientPromise = undefined
    console.warn(
      JSON.stringify({
        event: "feedback_score_client_initialization_failed",
        errorCategory: classifyObservabilityError(error),
      })
    )
    return null
  })
  return clientPromise
}

function feedbackValue(feedback: MessageFeedback | null): FeedbackScoreValue {
  return feedback ?? FEEDBACK_SCORE_VALUES.cleared
}

export async function prepareFeedbackScore(
  input: FeedbackMirrorInput,
  environment = resolveObservabilityConfig().environment
): Promise<FeedbackScoreBody> {
  return {
    id: await feedbackScoreId(input.messageId),
    traceId: await assistantMessageTraceId(input.messageId),
    name: SCORE_NAMES.productFeedback,
    value: feedbackValue(input.feedback),
    dataType: "CATEGORICAL",
    environment,
    metadata: {
      source: FEEDBACK_SCORE_SOURCE,
      sourceEntity: "assistant-message",
      sourceUpdatedAt: input.updatedAt,
      schemaVersion: FEEDBACK_SCORE_SCHEMA_VERSION,
    },
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error("Feedback Score mirror timed out")
          error.name = "TimeoutError"
          reject(error)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function mirrorMessageFeedback(
  input: FeedbackMirrorInput,
  dependencies: FeedbackMirrorDependencies = {}
): Promise<FeedbackMirrorResult> {
  const getClient = dependencies.getClient ?? getFeedbackScoreClient
  const shouldFlush = dependencies.flush ?? true
  const timeoutMs = dependencies.timeoutMs ?? 5_000

  try {
    const client = await getClient()
    if (!client) return { status: "skipped", reason: "langfuse-disabled" }

    const score = await prepareFeedbackScore(input)
    client.score.create(score)
    if (shouldFlush) await withTimeout(client.flush(), timeoutMs)
    return {
      status: shouldFlush ? "mirrored" : "queued",
      traceId: score.traceId,
      scoreId: score.id,
      value: score.value,
    }
  } catch (error) {
    const errorCategory = classifyObservabilityError(error)
    console.warn(
      JSON.stringify({
        event: "feedback_score_mirror_failed",
        errorCategory,
      })
    )
    return { status: "failed", errorCategory }
  }
}

export async function flushFeedbackScores(
  dependencies: Pick<FeedbackMirrorDependencies, "getClient" | "timeoutMs"> = {}
): Promise<"flushed" | "skipped" | "failed"> {
  try {
    const client = await (dependencies.getClient ?? getFeedbackScoreClient)()
    if (!client) return "skipped"
    await withTimeout(client.flush(), dependencies.timeoutMs ?? 10_000)
    return "flushed"
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "feedback_score_flush_failed",
        errorCategory: classifyObservabilityError(error),
      })
    )
    return "failed"
  }
}

export function resetFeedbackScoreClientForTests(): void {
  clientPromise = undefined
}
