import {
  readUIMessageStream,
  toUIMessageStream,
  type FinishReason,
  type TextStreamPart,
  type ToolSet,
} from "ai"
import type {
  ThreadChatUIMessage,
  ThreadChatUIMessageChunk,
} from "@/lib/thread-chat/contracts/ui-message"
import { createMarkdownArtifactProgressDispatcher } from "@/lib/chat/markdown-artifact"
import { createWebResearchActivityDispatcher } from "@/lib/chat/web-research-activity"
import type { StreamSessionController } from "@/lib/thread-chat/streaming/stream-session"

export interface UIMessagePipelineEnd {
  responseMessage: ThreadChatUIMessage
  isAborted: boolean
  finishReason?: FinishReason
}

export interface ConsumeUIMessagePipelineInput<TOOLS extends ToolSet> {
  textStream: ReadableStream<TextStreamPart<TOOLS>>
  tools?: TOOLS
  initialMessage: ThreadChatUIMessage
  session: StreamSessionController
  leadingChunks?: ThreadChatUIMessageChunk[]
  onSnapshot?: (message: ThreadChatUIMessage) => void | Promise<void>
  onProtocolError?: (error: unknown) => void
}

function isDataChunk(
  chunk: ThreadChatUIMessageChunk
): chunk is Extract<ThreadChatUIMessageChunk, { type: `data-${string}` }> {
  return chunk.type.startsWith("data-")
}

function chunkEmitsSnapshot(chunk: ThreadChatUIMessageChunk): boolean {
  if (isDataChunk(chunk)) return chunk.transient !== true
  switch (chunk.type) {
    case "start-step":
    case "finish-step":
    case "finish":
    case "abort":
    case "error":
      return false
    default:
      return true
  }
}

function transientKey(
  chunk: Extract<ThreadChatUIMessageChunk, { type: `data-${string}` }>
): string {
  return `${chunk.type}:${chunk.id ?? ""}`
}

function withTransientParts(
  snapshot: ThreadChatUIMessage,
  transientParts: Map<string, ThreadChatUIMessageChunk>
): ThreadChatUIMessage {
  if (transientParts.size === 0) return structuredClone(snapshot)
  return {
    ...structuredClone(snapshot),
    parts: [
      ...structuredClone(snapshot.parts),
      ...[...transientParts.values()].map((chunk) =>
        structuredClone({ ...chunk, transient: true })
      ),
    ] as ThreadChatUIMessage["parts"],
  }
}

function appendStepStart(snapshot: ThreadChatUIMessage): ThreadChatUIMessage {
  return {
    ...structuredClone(snapshot),
    parts: [...structuredClone(snapshot.parts), { type: "step-start" }],
  }
}

async function* injectLeadingChunks(
  stream: ReadableStream<ThreadChatUIMessageChunk>,
  leadingChunks: readonly ThreadChatUIMessageChunk[]
) {
  const reader = stream.getReader()
  let injected = false
  const derived: ThreadChatUIMessageChunk[] = []
  const artifactProgress = createMarkdownArtifactProgressDispatcher((data) => {
    derived.push({
      type: "data-artifact-progress",
      id: `artifact-progress:${data.toolCallId}`,
      data,
      transient: true,
    })
  })
  const researchActivity = createWebResearchActivityDispatcher((data) => {
    derived.push({
      type: "data-research-activity",
      id: `research-activity:${data.toolCallId}`,
      data,
    })
  })
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      yield result.value
      derived.length = 0
      await artifactProgress(result.value)
      researchActivity(result.value)
      for (const chunk of derived) yield chunk
      if (!injected && result.value.type === "start") {
        injected = true
        for (const chunk of leadingChunks) yield structuredClone(chunk)
      }
    }
    if (!injected) {
      for (const chunk of leadingChunks) yield structuredClone(chunk)
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * AI SDK v7 pipeline：TextStreamPart -> UIMessageChunk -> evolving UIMessage。
 * 每个 chunk 都先进入 readUIMessageStream 的持久 reducer，再由 Session 编号广播。
 */
export async function consumeUIMessagePipeline<TOOLS extends ToolSet>({
  textStream,
  tools,
  initialMessage,
  session,
  leadingChunks = [],
  onSnapshot,
  onProtocolError,
}: ConsumeUIMessagePipelineInput<TOOLS>): Promise<UIMessagePipelineEnd> {
  let end: UIMessagePipelineEnd | null = null
  const generated = toUIMessageStream<TOOLS, ThreadChatUIMessage>({
    stream: textStream,
    ...(tools ? { tools } : {}),
    generateMessageId: () => initialMessage.id,
    sendReasoning: true,
    sendSources: true,
    onError: (error) => {
      onProtocolError?.(error)
      return "生成过程中发生错误"
    },
    onEnd: (event) => {
      end = {
        responseMessage: event.responseMessage,
        isAborted: event.isAborted,
        finishReason: event.finishReason,
      }
    },
  }) as ReadableStream<ThreadChatUIMessageChunk>

  const reducerChannel = new TransformStream<
    ThreadChatUIMessageChunk,
    ThreadChatUIMessageChunk
  >()
  const reducerWriter = reducerChannel.writable.getWriter()
  const snapshotReader = readUIMessageStream<ThreadChatUIMessage>({
    message: structuredClone(initialMessage),
    stream: reducerChannel.readable,
    onError: onProtocolError,
    terminateOnError: true,
  }).getReader()

  let reducedSnapshot = structuredClone(initialMessage)
  let liveSnapshot = structuredClone(initialMessage)
  const transientParts = new Map<string, ThreadChatUIMessageChunk>()
  try {
    for await (const chunk of injectLeadingChunks(generated, leadingChunks)) {
      await reducerWriter.write(chunk)

      if (chunkEmitsSnapshot(chunk)) {
        const next = await snapshotReader.read()
        if (next.done) throw new Error("UI_MESSAGE_REDUCER_ENDED_EARLY")
        reducedSnapshot = next.value
      } else if (chunk.type === "start-step") {
        // readUIMessageStream 在下一个可见更新才 emit step-start；先同步覆盖 Session。
        reducedSnapshot = appendStepStart(reducedSnapshot)
      }

      if (isDataChunk(chunk) && chunk.transient === true) {
        transientParts.set(transientKey(chunk), structuredClone(chunk))
      }
      liveSnapshot = withTransientParts(reducedSnapshot, transientParts)
      session.publish(chunk, liveSnapshot)
      await onSnapshot?.(liveSnapshot)
    }
  } finally {
    await reducerWriter.close().catch(() => undefined)
    snapshotReader.releaseLock()
  }

  // 终态持久化不包含 transient data parts。
  liveSnapshot = structuredClone(reducedSnapshot)
  session.replaceSnapshot(liveSnapshot)
  await onSnapshot?.(liveSnapshot)
  return (
    end ?? {
      responseMessage: liveSnapshot,
      isAborted: session.signal.aborted,
    }
  )
}
