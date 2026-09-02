import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import type {
  ThreadChatUIMessage,
  ThreadChatUIMessageChunk,
} from "@/lib/thread-chat/contracts/ui-message"
import type {
  StreamEvent,
  StreamReplayChunk,
} from "@/lib/thread-chat/contracts/stream"

export type StreamSessionStatus = "running" | "terminal"
export type StreamSubscriber = (event: StreamEvent) => void

export interface StreamSession {
  readonly messageId: string
  readonly abortController: AbortController
  readonly subscribers: Set<StreamSubscriber>
  status: StreamSessionStatus
  snapshot: ThreadChatUIMessage
  eventSeq: number
  /**
   * AI SDK v7 reducer 的续接日志。UIMessage parts 不保留 text/tool chunk 的内部
   * ID，所以迟到订阅者必须从第一个 chunk 重放，不能只从半成品 snapshot 续 delta。
   * 日志随终态 Session 的 TTL cleanup 一并释放，不写数据库。
   */
  replay: StreamReplayChunk[]
  finishedAt: number | null
  terminalMessage: MessageDTO | null
  task: Promise<void> | null
}

export interface StreamSessionController {
  readonly messageId: string
  readonly signal: AbortSignal
  getSnapshot(): ThreadChatUIMessage
  publish(chunk: ThreadChatUIMessageChunk, snapshot: ThreadChatUIMessage): void
  replaceSnapshot(snapshot: ThreadChatUIMessage): void
  finish(message: MessageDTO, snapshot?: ThreadChatUIMessage): void
}

export function initialAssistantSnapshot(input: {
  messageId: string
  threadId: string
  modelId?: string
}): ThreadChatUIMessage {
  return {
    id: input.messageId,
    role: "assistant",
    parts: [],
    metadata: {
      messageId: input.messageId,
      threadId: input.threadId,
      ...(input.modelId ? { modelId: input.modelId } : {}),
    },
  }
}
