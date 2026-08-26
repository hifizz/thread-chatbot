import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import type {
  ThreadChatUIMessage,
  ThreadChatUIMessageChunk,
} from "@/lib/thread-chat/contracts/ui-message"
import type { StreamEvent } from "@/lib/thread-chat/contracts/stream"

export type StreamSessionStatus = "running" | "terminal"
export type StreamSubscriber = (event: StreamEvent) => void

export interface StreamSession {
  readonly messageId: string
  readonly abortController: AbortController
  readonly subscribers: Set<StreamSubscriber>
  status: StreamSessionStatus
  snapshot: ThreadChatUIMessage
  eventSeq: number
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
