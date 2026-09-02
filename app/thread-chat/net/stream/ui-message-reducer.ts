import { readUIMessageStream } from "ai"
import type {
  ThreadChatUIMessage,
  ThreadChatUIMessageChunk,
} from "@/lib/thread-chat/contracts/ui-message"
import type { StreamReplayChunk } from "@/lib/thread-chat/contracts/stream"
import { THREAD_CHAT_REDUCER_FLUSH_TIMEOUT_MS } from "@/constants/thread-chat-stream"

function emptyReplayBase(snapshot: ThreadChatUIMessage): ThreadChatUIMessage {
  return {
    id: snapshot.id,
    role: "assistant",
    parts: [],
    ...(snapshot.metadata !== undefined
      ? { metadata: structuredClone(snapshot.metadata) }
      : {}),
  }
}

/**
 * 一个 SSE 连接只创建一个 AI SDK v7 reducer。它持有 text/reasoning/tool 的
 * active chunk ID；若逐 chunk 重建 reducer，这些 ID 会丢失，下一条 delta 必然失败。
 */
export class ThreadChatUIMessageReducer {
  private inputController!: ReadableStreamDefaultController<ThreadChatUIMessageChunk>
  private readonly outputTask: Promise<void>
  private closed = false
  private failure: unknown = null
  private value: ThreadChatUIMessage
  private readonly transientParts = new Map<string, ThreadChatUIMessageChunk>()
  private onMessage: ((message: ThreadChatUIMessage) => void) | undefined
  private onError: ((error: unknown) => void) | undefined
  private barrier:
    | {
        markerId: string
        originalId: string
        markerSeen: boolean
        resolve(message: ThreadChatUIMessage): void
        reject(error: unknown): void
        timeout: ReturnType<typeof setTimeout>
      }
    | undefined

  constructor(initial: ThreadChatUIMessage) {
    this.value = structuredClone(initial)
    const input = new ReadableStream<ThreadChatUIMessageChunk>({
      start: (controller) => {
        this.inputController = controller
      },
    })
    const output = readUIMessageStream<ThreadChatUIMessage>({
      message: structuredClone(initial),
      stream: input,
      terminateOnError: true,
    })
    this.outputTask = this.consumeOutput(output)
  }

  setHandlers(handlers: {
    onMessage?: (message: ThreadChatUIMessage) => void
    onError?: (error: unknown) => void
  }): void {
    this.onMessage = handlers.onMessage
    this.onError = handlers.onError
  }

  current(): ThreadChatUIMessage {
    if (this.transientParts.size === 0) return structuredClone(this.value)
    return {
      ...structuredClone(this.value),
      parts: [
        ...structuredClone(this.value.parts),
        ...[...this.transientParts.values()].map((part) =>
          structuredClone({ ...part, transient: true })
        ),
      ] as ThreadChatUIMessage["parts"],
    }
  }

  push(chunk: ThreadChatUIMessageChunk): void {
    if (this.closed) throw new Error("UI_MESSAGE_REDUCER_CLOSED")
    if (this.failure) throw this.failure
    this.inputController.enqueue(structuredClone(chunk))
    if (
      chunk.type.startsWith("data-") &&
      "transient" in chunk &&
      chunk.transient === true
    ) {
      this.transientParts.set(
        `${chunk.type}:${"id" in chunk ? (chunk.id ?? "") : ""}`,
        structuredClone(chunk)
      )
      this.onMessage?.(this.current())
    }
  }

  /**
   * 等待此前入队的所有 chunk 被官方 reducer 处理完。
   * 使用临时 messageId 作为队尾 barrier，再立即恢复原 ID；不依赖任何 chunk type
   * 名单，也不会把 marker 写进 parts、SSE 或数据库。
   */
  flush(): Promise<ThreadChatUIMessage> {
    if (this.closed)
      return Promise.reject(new Error("UI_MESSAGE_REDUCER_CLOSED"))
    if (this.failure) return Promise.reject(this.failure)
    if (this.barrier)
      return Promise.reject(new Error("UI_MESSAGE_REDUCER_FLUSH_ACTIVE"))
    const originalId = this.value.id
    const markerId = `__thread-chat-reducer-barrier:${crypto.randomUUID()}`
    return new Promise<ThreadChatUIMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error("UI_MESSAGE_REDUCER_FLUSH_TIMEOUT")
        this.failure = error
        this.barrier = undefined
        reject(error)
        this.onError?.(error)
      }, THREAD_CHAT_REDUCER_FLUSH_TIMEOUT_MS)
      timeout.unref?.()
      this.barrier = {
        markerId,
        originalId,
        markerSeen: false,
        resolve,
        reject,
        timeout,
      }
      this.inputController.enqueue({ type: "start", messageId: markerId })
      this.inputController.enqueue({ type: "start", messageId: originalId })
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const barrier = this.barrier
    this.barrier = undefined
    if (barrier) {
      clearTimeout(barrier.timeout)
      barrier.reject(new Error("UI_MESSAGE_REDUCER_CLOSED"))
    }
    // 只结束 reducer 的输入。主动 cancel 输出 iterator 会与 AI SDK 内部 finally
    // 同时 close controller，Node Web Streams 会报 Controller is already closed。
    try {
      this.inputController.close()
    } catch {
      // reducer 已因协议错误关闭时无需再次处理
    }
  }

  private async consumeOutput(
    output: AsyncIterable<ThreadChatUIMessage>
  ): Promise<void> {
    try {
      for await (const message of output) {
        const barrier = this.barrier
        if (barrier && message.id === barrier.markerId) {
          barrier.markerSeen = true
          continue
        }
        if (barrier?.markerSeen && message.id === barrier.originalId) {
          this.value = message
          this.barrier = undefined
          clearTimeout(barrier.timeout)
          barrier.resolve(this.current())
          continue
        }
        this.value = message
        this.onMessage?.(this.current())
      }
    } catch (error) {
      this.failure = error
      const barrier = this.barrier
      this.barrier = undefined
      if (barrier) clearTimeout(barrier.timeout)
      barrier?.reject(error)
      this.onError?.(error)
    }
  }
}

export async function replayThreadChatUIMessage(input: {
  snapshot: ThreadChatUIMessage
  replay: readonly StreamReplayChunk[]
}): Promise<ThreadChatUIMessageReducer> {
  const reducer = new ThreadChatUIMessageReducer(
    emptyReplayBase(input.snapshot)
  )
  for (let index = 0; index < input.replay.length; index += 1) {
    const event = input.replay[index]
    if (!event || event.seq !== index + 1) {
      reducer.close()
      throw new Error("STREAM_REPLAY_SEQUENCE_MISMATCH")
    }
    reducer.push(event.chunk)
  }
  await reducer.flush()
  if (
    JSON.stringify(reducer.current().parts) !==
    JSON.stringify(input.snapshot.parts)
  ) {
    reducer.close()
    throw new Error("STREAM_REPLAY_SNAPSHOT_MISMATCH")
  }
  return reducer
}
