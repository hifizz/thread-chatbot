import { THREAD_CHAT_STREAM_HEARTBEAT_MS } from "@/constants/thread-chat-stream"
import {
  serializeStreamEvent,
  type StreamEvent,
} from "@/lib/thread-chat/contracts/stream"
import type { SessionStore } from "@/lib/thread-chat/streaming/session-store"

const encoder = new TextEncoder()

export function encodeStreamEvent(event: StreamEvent): Uint8Array {
  return encoder.encode(`data: ${serializeStreamEvent(event)}\n\n`)
}

export function createSessionSseResponse({
  store,
  messageId,
  heartbeatMs = THREAD_CHAT_STREAM_HEARTBEAT_MS,
}: {
  store: SessionStore
  messageId: string
  heartbeatMs?: number
}): Response | null {
  if (!store.get(messageId)) return null

  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let terminalDelivered = false
      const close = () => {
        unsubscribe?.()
        unsubscribe = null
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = null
      }
      try {
        const registeredUnsubscribe = store.subscribe(messageId, (event) => {
          controller.enqueue(encodeStreamEvent(event))
          if (event.type === "terminal") {
            terminalDelivered = true
            close()
            controller.close()
          }
        })
        unsubscribe = registeredUnsubscribe
        if (terminalDelivered) {
          unsubscribe()
          unsubscribe = null
          return
        }
        heartbeat = setInterval(() => {
          controller.enqueue(
            encodeStreamEvent({
              type: "heartbeat",
              at: new Date().toISOString(),
            })
          )
        }, heartbeatMs)
        heartbeat.unref?.()
      } catch (error) {
        close()
        controller.error(error)
      }
    },
    cancel() {
      unsubscribe?.()
      unsubscribe = null
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
