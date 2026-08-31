import type { LanguageModelUsage, TextStreamPart, ToolSet } from "ai"
import { db } from "@/lib/db"
import type { ThreadChatUIMessageChunk } from "@/lib/thread-chat/contracts/ui-message"
import { compilePromptBase } from "@/lib/thread-chat/application/prompt-compiler"
import type { PromptManifest } from "@/lib/thread-chat/application/prompt-cache"
import type { PromptCacheControls } from "@/lib/ai/prompt-cache"
import type {
  ModelAttemptRecord,
  ModelAttemptSummary,
} from "@/lib/ai/model-attempt"
import {
  findOwnedMessage,
  listThreadMessageRows,
} from "@/lib/thread-chat/persistence/message-repository"
import { findOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"
import { MessageCheckpointer } from "@/lib/thread-chat/streaming/checkpoint"
import { finalizeGeneration } from "@/lib/thread-chat/streaming/finalize"
import { prepareGeneration } from "@/lib/thread-chat/streaming/generation-plan"
import type { StreamSessionController } from "@/lib/thread-chat/streaming/stream-session"
import { consumeUIMessagePipeline } from "@/lib/thread-chat/streaming/ui-message-pipeline"
import { resolveGenerationTerminalOutcome } from "@/lib/thread-chat/streaming/generation-outcome"
import { OBSERVATION_NAMES, TRACE_NAMES } from "@/constants/observability"
import { buildThreadChatTraceInput } from "@/lib/observability/context"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import { assistantMessageTraceId } from "@/lib/observability/identity"
import { safeErrorMetadata } from "@/lib/observability/error"
import { observeAppOperation, runAgentTrace } from "@/lib/observability/trace"
import type { ObservabilityContext } from "@/lib/observability/types"

export interface PreparedGeneration {
  textStream: ReadableStream<TextStreamPart<ToolSet>>
  tools?: ToolSet
  leadingChunks?: ThreadChatUIMessageChunk[]
  usage?: PromiseLike<LanguageModelUsage>
  manifest?: PromptManifest
  cacheControls?: PromptCacheControls
  route?: {
    routeId: string
    upstreamModelId: string
    adapter: string
    gateway: string | null
  }
  modelAttempts?: () => ModelAttemptRecord[]
  cacheSummary?: () => ModelAttemptSummary
}

export interface RunGenerationDependencies {
  prepare?: (
    input: Parameters<typeof prepareGeneration>[0]
  ) => Promise<PreparedGeneration>
  finalize?: typeof finalizeGeneration
}

type GenerationIdentity = {
  message: NonNullable<Awaited<ReturnType<typeof findOwnedMessage>>> & {
    modelId: string
  }
  thread: NonNullable<Awaited<ReturnType<typeof findOwnedThread>>>
}

type GenerationRunResult = {
  status: "completed" | "stopped" | "failed"
  finishReason: string
  partCount: number
  providerUsage?: Record<string, unknown>
  manifest?: PromptManifest
  cacheControls?: PromptCacheControls
  routeId?: string
  modelAttempts: ModelAttemptRecord[]
  cacheSummary?: ModelAttemptSummary
  checkpoint: ReturnType<MessageCheckpointer["getSummary"]>
  error?: ReturnType<typeof safeErrorMetadata>
}

function textFromParts(parts: readonly unknown[]): string {
  return parts
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return []
      const value = part as Record<string, unknown>
      return value.type === "text" && typeof value.text === "string"
        ? [value.text]
        : []
    })
    .join("\n")
}

function rawUsage(
  usage: LanguageModelUsage | undefined
): Record<string, unknown> | undefined {
  if (!usage) return undefined
  return JSON.parse(JSON.stringify(usage)) as Record<string, unknown>
}

async function loadGenerationIdentity({
  userId,
  messageId,
}: {
  userId: string
  messageId: string
}): Promise<GenerationIdentity> {
  const message = await findOwnedMessage(db, userId, messageId)
  if (
    !message ||
    message.role !== "assistant" ||
    message.status !== "generating" ||
    !message.modelId
  ) {
    throw new Error("GENERATION_MESSAGE_NOT_READY")
  }
  const thread = await findOwnedThread(db, userId, message.threadId)
  if (!thread || thread.projectId !== message.projectId)
    throw new Error("GENERATION_THREAD_NOT_FOUND")
  return { message: { ...message, modelId: message.modelId }, thread }
}

async function runGenerationCore({
  userId,
  session,
  identity,
  observabilityContext,
  dependencies = {},
}: {
  userId: string
  session: StreamSessionController
  identity: GenerationIdentity
  observabilityContext: ObservabilityContext
  dependencies?: RunGenerationDependencies
}): Promise<GenerationRunResult> {
  const { message, thread } = identity
  const rows = await listThreadMessageRows(
    db,
    message.projectId,
    message.threadId
  )
  const currentRows = rows.filter(
    (row) => row.supersededAt === null && row.sequence < message.sequence
  )
  const latestUser = [...currentRows]
    .reverse()
    .find((row) => row.role === "user")
  if (!latestUser) throw new Error("GENERATION_USER_MESSAGE_NOT_FOUND")
  const promptBase = await compilePromptBase({
    userId,
    threadId: thread.id,
    excludeAssistantMessageId: message.id,
  })
  const prepare = dependencies.prepare ?? prepareGeneration
  const checkpointer = new MessageCheckpointer(message.id)
  let protocolError: unknown = null
  let prepared: PreparedGeneration | null = null
  let pipelineEnd: Awaited<
    ReturnType<typeof consumeUIMessagePipeline<ToolSet>>
  > | null = null
  let thrown: unknown = null

  try {
    prepared = await prepare({
      userId,
      messageId: message.id,
      projectId: message.projectId,
      threadId: thread.id,
      modelId: message.modelId,
      observabilityContext,
      latestUserText: textFromParts(latestUser.parts),
      recentConversation: currentRows
        .slice(-6)
        .map((row) => `${row.role}: ${textFromParts(row.parts)}`)
        .join("\n"),
      promptBase,
      abortSignal: session.signal,
    })
    pipelineEnd = await consumeUIMessagePipeline({
      textStream: prepared.textStream,
      ...(prepared.tools ? { tools: prepared.tools } : {}),
      initialMessage: session.getSnapshot(),
      session,
      leadingChunks: prepared.leadingChunks,
      onSnapshot: (snapshot) => checkpointer.schedule(snapshot),
      onProtocolError: (error) => {
        protocolError ??= error
      },
    })
  } catch (error) {
    thrown = error
  }

  const snapshot = session.getSnapshot()
  await observeAppOperation(
    OBSERVATION_NAMES.persistenceCheckpoint,
    { metadata: { assistantMessageId: message.id } },
    async (observation) => {
      const persisted = await checkpointer.flush(snapshot)
      observation.update({
        output: { persisted },
        metadata: checkpointer.getSummary(),
      })
      return persisted
    }
  ).catch((error) => {
    console.warn("[thread-chat] 生成 checkpoint flush 失败:", error)
  })
  checkpointer.stop()
  const usage = prepared?.usage
    ? await Promise.resolve(prepared.usage).catch(() => undefined)
    : undefined
  const modelAttempts = prepared?.modelAttempts?.() ?? []
  const cacheSummary = prepared?.cacheSummary?.()
  const outcome = resolveGenerationTerminalOutcome({
    signal: session.signal,
    pipelineAborted: pipelineEnd?.isAborted === true,
    sdkOutcome: pipelineEnd?.outcome,
    thrown,
    protocolError,
    ...(pipelineEnd?.finishReason
      ? { finishReason: pipelineEnd.finishReason }
      : {}),
  })
  const providerUsage = rawUsage(usage)
  const resolvedFinishReason =
    pipelineEnd?.finishReason ?? (outcome.failed ? "error" : undefined)
  const terminal = await observeAppOperation(
    OBSERVATION_NAMES.generationFinalize,
    {
      metadata: {
        assistantMessageId: message.id,
        requestedStatus: outcome.status,
        modelAttemptCount: modelAttempts.length,
        ...(cacheSummary
          ? {
              cacheOutcome: cacheSummary.cacheOutcome,
              cacheReadTokens: cacheSummary.usage.cacheReadTokens,
              cacheWriteTokens: cacheSummary.usage.cacheWriteTokens,
              uncachedInputTokens: cacheSummary.usage.uncachedInputTokens,
              modelCostUsd: cacheSummary.usage.costUsd,
            }
          : {}),
        ...(prepared?.manifest
          ? {
              stableRequestPrefixHash:
                prepared.manifest.stableRequestPrefixHash,
              cacheEligibility:
                prepared.manifest.cacheEligibility.reason,
              toolProfileId: prepared.manifest.toolProfileId,
              providerRouteId: prepared.manifest.routeId,
              currentUserQuoteCount:
                prepared.manifest.currentUserQuoteCount,
            }
          : {}),
      },
    },
    async (observation) => {
      const finalized = await (dependencies.finalize ?? finalizeGeneration)({
        messageId: message.id,
        snapshot,
        status: outcome.status,
        finishReason: resolvedFinishReason,
        providerUsage,
        ...(outcome.failed
          ? {
              error: {
                code: "GENERATION_FAILED",
                message: "生成过程中发生错误",
              },
            }
          : {}),
      })
      observation.update({
        output: {
          status: finalized.status,
          finishReason: resolvedFinishReason ?? "unknown",
          partCount: finalized.parts.length,
        },
      })
      return finalized
    }
  )
  session.finish(terminal, {
    ...snapshot,
    parts: terminal.parts,
  })
  return {
    status: terminal.status as GenerationRunResult["status"],
    finishReason: resolvedFinishReason ?? "unknown",
    partCount: terminal.parts.length,
    ...(providerUsage ? { providerUsage } : {}),
    ...(prepared?.manifest ? { manifest: prepared.manifest } : {}),
    ...(prepared?.cacheControls
      ? { cacheControls: prepared.cacheControls }
      : {}),
    ...(prepared?.route?.routeId ? { routeId: prepared.route.routeId } : {}),
    modelAttempts,
    ...(cacheSummary ? { cacheSummary } : {}),
    checkpoint: checkpointer.getSummary(),
    ...(outcome.failed && (thrown || protocolError)
      ? { error: safeErrorMetadata(thrown ?? protocolError) }
      : {}),
  }
}

export async function runGeneration(input: {
  userId: string
  messageId: string
  session: StreamSessionController
  dependencies?: RunGenerationDependencies
}): Promise<void> {
  try {
    const identity = await loadGenerationIdentity(input)
    const traceInput = await buildThreadChatTraceInput({
      userId: input.userId,
      projectId: identity.message.projectId,
      threadId: identity.thread.id,
      assistantMessageId: identity.message.id,
      modelId: identity.message.modelId!,
    })
    await runAgentTrace(traceInput, async (observation) => {
      const result = await runGenerationCore({
        userId: input.userId,
        session: input.session,
        identity,
        observabilityContext: traceInput.context,
        ...(input.dependencies ? { dependencies: input.dependencies } : {}),
      })
      observation.update({
        level: result.status === "failed" ? "ERROR" : "DEFAULT",
        statusMessage: `generation ${result.status}`,
        output: {
          status: result.status,
          finishReason: result.finishReason,
          partCount: result.partCount,
        },
        metadata: {
          ...result.checkpoint,
          ...(result.error ?? {}),
          hasProviderUsage: Boolean(result.providerUsage),
          modelAttemptCount: result.modelAttempts.length,
          ...(result.cacheSummary
            ? {
                cacheOutcome: result.cacheSummary.cacheOutcome,
                cacheReadTokens: result.cacheSummary.usage.cacheReadTokens,
                cacheWriteTokens: result.cacheSummary.usage.cacheWriteTokens,
                uncachedInputTokens:
                  result.cacheSummary.usage.uncachedInputTokens,
                modelCostUsd: result.cacheSummary.usage.costUsd,
                cacheUsageComplete: result.cacheSummary.usage.complete,
              }
            : {}),
          ...(result.manifest
            ? {
                promptCompilerVersion:
                  result.manifest.promptCompilerVersion,
                stableRequestPrefixHash:
                  result.manifest.stableRequestPrefixHash,
                cacheEligibility:
                  result.manifest.cacheEligibility.reason,
                toolProfileId: result.manifest.toolProfileId,
                currentUserQuoteCount:
                  result.manifest.currentUserQuoteCount,
              }
            : {}),
          ...(result.cacheControls
            ? {
                promptCacheMode: result.cacheControls.mode,
                promptCacheEnabled: result.cacheControls.enabled,
                promptCacheReason: result.cacheControls.reason,
              }
            : {}),
          ...(result.routeId ? { providerRouteId: result.routeId } : {}),
        },
      })
    })
  } catch (error) {
    const snapshot = input.session.getSnapshot()
    const config = resolveObservabilityConfig()
    await runAgentTrace(
      {
        name: TRACE_NAMES.threadChatGeneration,
        traceId: await assistantMessageTraceId(input.messageId),
        tags: ["thread-chat", "initialization-failure"],
        context: {
          assistantMessageId: input.messageId,
          environment: config.environment,
          release: config.release,
          entrypoint: "thread-chat",
        },
      },
      async (observation) => {
        const terminal = await observeAppOperation(
          OBSERVATION_NAMES.generationFinalize,
          {
            level: "ERROR",
            metadata: {
              assistantMessageId: input.messageId,
              requestedStatus: "failed",
              ...safeErrorMetadata(error),
            },
          },
          () =>
            (input.dependencies?.finalize ?? finalizeGeneration)({
              messageId: input.messageId,
              snapshot,
              status: "failed",
              finishReason: "error",
              error: {
                code: "GENERATION_FAILED",
                message: "生成初始化失败",
              },
            })
        )
        input.session.finish(terminal, { ...snapshot, parts: terminal.parts })
        observation.update({
          level: "ERROR",
          statusMessage: "generation initialization failed",
          output: { status: terminal.status, finishReason: "error" },
          metadata: safeErrorMetadata(error),
        })
      }
    )
  }
}
