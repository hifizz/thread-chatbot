import type { GenerationAcceptedDTO } from "@/lib/thread-chat/contracts/dto"
import type { ConversationStore } from "../../core/store"
import type { ThreadChatClient } from "../client"
import { subscribeToMessageStream, type StreamSubscription } from "./sse-client"
import { startTerminalPoller, type TerminalPoller } from "./terminal-poller"
import {
  replayThreadChatUIMessage,
  type ThreadChatUIMessageReducer,
} from "./ui-message-reducer"

export interface GenerationConnection {
  messageId: string
  finished: Promise<void>
  close(): void
}

export function reconcileAcceptedGeneration(
  store: ConversationStore,
  accepted: GenerationAcceptedDTO
): void {
  const state = store.getState()
  state.upsertProject(accepted.project)
  state.upsertThread(accepted.thread)
  if (accepted.userMessage) state.upsertMessage(accepted.userMessage)
  state.upsertMessage(accepted.assistantMessage)
}

/**
 * 首次接受命令后只建立一次 SSE。连接失败/断开时立即进入 background poll，
 * 不发送 Last-Event-ID，也不会重新调用生成命令。
 */
export function followAcceptedGeneration(options: {
  store: ConversationStore
  client: ThreadChatClient
  accepted: GenerationAcceptedDTO
  fetch?: typeof globalThis.fetch
}): GenerationConnection {
  const { store, client, accepted } = options
  reconcileAcceptedGeneration(store, accepted)
  const messageId = accepted.assistantMessage.id
  let reducer: ThreadChatUIMessageReducer | null = null
  let subscription: StreamSubscription | null = null
  let poller: TerminalPoller | null = null
  let closed = false
  let lastServerSeq = 0
  let renderRevision = 0

  let resolveFinished!: () => void
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })

  const beginPoll = () => {
    if (closed || poller) return
    store.getState().markBackgroundGeneration(messageId)
    poller = startTerminalPoller({
      messageId,
      getMessage: client.getMessage,
      onGenerating(message) {
        // Store 保留 liveMessage；checkpoint 只更新权威 DTO，不覆盖较新的内存 parts。
        store.getState().mergePolledMessage(message)
      },
      onTerminal(message) {
        store.getState().reconcileTerminalMessage(message)
        resolveFinished()
      },
    })
  }

  store.getState().markBackgroundGeneration(messageId)
  subscription = subscribeToMessageStream({
    url: accepted.streamUrl,
    fetch: options.fetch,
    async onEvent(event) {
      if (closed) return
      if (event.type === "snapshot") {
        reducer?.close()
        reducer = await replayThreadChatUIMessage({
          snapshot: event.message,
          replay: event.replay,
        })
        lastServerSeq = event.throughSeq
        renderRevision = event.throughSeq
        reducer.setHandlers({
          onMessage(message) {
            renderRevision += 1
            store
              .getState()
              .applyStreamChunk(messageId, message, renderRevision)
          },
          onError() {
            reducer?.setHandlers({})
            reducer?.close()
            reducer = null
            subscription?.close()
            beginPoll()
          },
        })
        store
          .getState()
          .applyStreamSnapshot(messageId, event.message, event.throughSeq)
      } else if (event.type === "chunk") {
        if (!reducer) throw new Error("STREAM_CHUNK_BEFORE_SNAPSHOT")
        if (event.seq !== lastServerSeq + 1)
          throw new Error("STREAM_CHUNK_SEQUENCE_MISMATCH")
        lastServerSeq = event.seq
        reducer.push(event.chunk)
      } else if (event.type === "terminal") {
        reducer?.setHandlers({})
        store.getState().reconcileTerminalMessage(event.message)
        reducer?.close()
        reducer = null
        resolveFinished()
      }
    },
    onDisconnect() {
      reducer?.setHandlers({})
      reducer?.close()
      reducer = null
      beginPoll()
    },
  })
  void subscription.closed.then(() => {
    const phase = store.getState().streamByMessageId[messageId]?.phase
    if (!closed && phase !== "terminal") beginPoll()
  })

  return {
    messageId,
    finished,
    close() {
      if (closed) return
      closed = true
      subscription?.close()
      poller?.stop()
      reducer?.setHandlers({})
      reducer?.close()
      resolveFinished()
    },
  }
}

export function pollBackgroundGeneration(options: {
  store: ConversationStore
  client: ThreadChatClient
  messageId: string
}): GenerationConnection {
  const { store, client, messageId } = options
  store.getState().markBackgroundGeneration(messageId)
  const poller = startTerminalPoller({
    messageId,
    getMessage: client.getMessage,
    onGenerating: (message) => store.getState().mergePolledMessage(message),
    onTerminal: (message) => store.getState().reconcileTerminalMessage(message),
  })
  return {
    messageId,
    finished: poller.finished.then(() => undefined),
    close: poller.stop,
  }
}
