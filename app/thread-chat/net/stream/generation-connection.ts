import type { GenerationAcceptedDTO } from "@/lib/thread-chat/contracts/dto"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type { ConversationStore } from "../../core/store"
import type { ThreadChatClient } from "../client"
import { subscribeToMessageStream, type StreamSubscription } from "./sse-client"
import { startTerminalPoller, type TerminalPoller } from "./terminal-poller"
import { reduceThreadChatUIMessage } from "./ui-message-reducer"

export interface GenerationConnection {
  messageId: string
  finished: Promise<void>
  close(): void
}

function initialUIMessage(accepted: GenerationAcceptedDTO): ThreadChatUIMessage {
  return {
    id: accepted.assistantMessage.id,
    role: "assistant",
    metadata: {
      messageId: accepted.assistantMessage.id,
      threadId: accepted.thread.id,
      ...(accepted.assistantMessage.modelId
        ? { modelId: accepted.assistantMessage.modelId }
        : {}),
    },
    parts: accepted.assistantMessage.parts,
  }
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
  let current = initialUIMessage(accepted)
  let subscription: StreamSubscription | null = null
  let poller: TerminalPoller | null = null
  let closed = false

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
        current = event.message
        store
          .getState()
          .applyStreamSnapshot(messageId, event.message, event.throughSeq)
      } else if (event.type === "chunk") {
        current = await reduceThreadChatUIMessage(current, event.chunk)
        store.getState().applyStreamChunk(messageId, current, event.seq)
      } else if (event.type === "terminal") {
        store.getState().reconcileTerminalMessage(event.message)
        resolveFinished()
      }
    },
    onDisconnect() {
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

