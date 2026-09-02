import { THREAD_CHAT_TERMINAL_POLL_DELAYS_MS } from "@/constants/thread-chat-stream"
import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"

export interface TerminalPollerOptions {
  messageId: string
  getMessage(messageId: string): Promise<MessageDTO>
  onGenerating(message: MessageDTO): void
  onTerminal(message: MessageDTO): void
  onError?(error: unknown): void
  delays?: readonly number[]
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>
}

function waitFor(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, delayMs)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

export interface TerminalPoller {
  finished: Promise<MessageDTO | null>
  stop(): void
}

export function startTerminalPoller(options: TerminalPollerOptions): TerminalPoller {
  const controller = new AbortController()
  const delays = options.delays ?? THREAD_CHAT_TERMINAL_POLL_DELAYS_MS
  const wait = options.wait ?? waitFor
  const finished = (async () => {
    let attempt = 0
    while (!controller.signal.aborted) {
      const delay = delays[Math.min(attempt, delays.length - 1)] ?? 5_000
      await wait(delay, controller.signal)
      if (controller.signal.aborted) return null
      try {
        const message = await options.getMessage(options.messageId)
        if (message.status === "generating") {
          options.onGenerating(message)
          attempt += 1
          continue
        }
        options.onTerminal(message)
        return message
      } catch (error) {
        options.onError?.(error)
        attempt += 1
      }
    }
    return null
  })()
  return {
    finished,
    stop() {
      controller.abort()
    },
  }
}

