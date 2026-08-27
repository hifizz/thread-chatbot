import type { LanguageModelUsage, TextStreamPart, ToolSet } from "ai"
import { db } from "@/lib/db"
import type { ThreadChatUIMessageChunk } from "@/lib/thread-chat/contracts/ui-message"
import { compileModelContext } from "@/lib/thread-chat/application/compile-model-context"
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

export interface PreparedGeneration {
  textStream: ReadableStream<TextStreamPart<ToolSet>>
  tools?: ToolSet
  leadingChunks?: ThreadChatUIMessageChunk[]
  usage?: PromiseLike<LanguageModelUsage>
}

export interface RunGenerationDependencies {
  prepare?: (
    input: Parameters<typeof prepareGeneration>[0]
  ) => Promise<PreparedGeneration>
  finalize?: typeof finalizeGeneration
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

async function runGenerationCore({
  userId,
  messageId,
  session,
  dependencies = {},
}: {
  userId: string
  messageId: string
  session: StreamSessionController
  dependencies?: RunGenerationDependencies
}): Promise<void> {
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
  const modelMessages = await compileModelContext({
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
      messageId: message.id,
      threadId: thread.id,
      modelId: message.modelId,
      latestUserText: textFromParts(latestUser.parts),
      recentConversation: currentRows
        .slice(-6)
        .map((row) => `${row.role}: ${textFromParts(row.parts)}`)
        .join("\n"),
      anchorText: thread.anchorText,
      modelMessages,
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
  await checkpointer.flush(snapshot).catch((error) => {
    thrown ??= error
  })
  checkpointer.stop()
  const usage = prepared?.usage
    ? await Promise.resolve(prepared.usage).catch(() => undefined)
    : undefined
  const outcome = resolveGenerationTerminalOutcome({
    signal: session.signal,
    pipelineAborted: pipelineEnd?.isAborted === true,
    thrown,
    protocolError,
    ...(pipelineEnd?.finishReason
      ? { finishReason: pipelineEnd.finishReason }
      : {}),
  })
  const terminal = await (dependencies.finalize ?? finalizeGeneration)({
    messageId: message.id,
    snapshot,
    status: outcome.status,
    finishReason:
      pipelineEnd?.finishReason ?? (outcome.failed ? "error" : undefined),
    providerUsage: rawUsage(usage),
    ...(outcome.failed
      ? {
          error: {
            code: "GENERATION_FAILED",
            message: "生成过程中发生错误",
          },
        }
      : {}),
  })
  session.finish(terminal, {
    ...snapshot,
    parts: terminal.parts,
  })
}

export async function runGeneration(
  input: Parameters<typeof runGenerationCore>[0]
): Promise<void> {
  try {
    await runGenerationCore(input)
  } catch {
    const snapshot = input.session.getSnapshot()
    const terminal = await (input.dependencies?.finalize ?? finalizeGeneration)(
      {
        messageId: input.messageId,
        snapshot,
        status: "failed",
        finishReason: "error",
        error: {
          code: "GENERATION_FAILED",
          message: "生成初始化失败",
        },
      }
    )
    input.session.finish(terminal, { ...snapshot, parts: terminal.parts })
  }
}
