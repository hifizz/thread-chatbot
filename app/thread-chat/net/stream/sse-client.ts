import {
  parseStreamEvent,
  type StreamEvent,
} from "@/lib/thread-chat/contracts/stream"

export interface StreamSubscription {
  closed: Promise<void>
  close(): void
}

export interface SubscribeToMessageStreamOptions {
  url: string
  onEvent(event: StreamEvent): void | Promise<void>
  onDisconnect?(error?: unknown): void
  fetch?: typeof globalThis.fetch
}

function eventPayloads(buffer: string): { payloads: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n")
  const blocks = normalized.split("\n\n")
  const rest = blocks.pop() ?? ""
  const payloads = blocks.flatMap((block) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
    return data ? [data] : []
  })
  return { payloads, rest }
}

/** 一次连接；失败或断开后由上层切换 poll，绝不自动 reconnect。 */
export function subscribeToMessageStream(
  options: SubscribeToMessageStreamOptions
): StreamSubscription {
  const controller = new AbortController()
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  let endedByTerminal = false
  const closed = (async () => {
    let disconnectError: unknown
    try {
      const response = await fetcher(options.url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      })
      if (!response.ok || !response.body)
        throw new Error(`SSE unavailable (${response.status})`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          const read = await reader.read()
          if (read.done) break
          buffer += decoder.decode(read.value, { stream: true })
          const decoded = eventPayloads(buffer)
          buffer = decoded.rest
          for (const payload of decoded.payloads) {
            const event = parseStreamEvent(JSON.parse(payload))
            await options.onEvent(event)
            if (event.type === "terminal") {
              endedByTerminal = true
              await reader.cancel()
              return
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      if (!controller.signal.aborted) disconnectError = error
    } finally {
      if (!endedByTerminal && !controller.signal.aborted)
        options.onDisconnect?.(disconnectError)
    }
  })()
  return {
    closed,
    close() {
      controller.abort()
    },
  }
}

