import {
  THREAD_CHAT_SESSION_CLEANUP_INTERVAL_MS,
  THREAD_CHAT_SESSION_TERMINAL_TTL_MS,
} from "@/constants/thread-chat-stream"
import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import type {
  ThreadChatUIMessage,
  ThreadChatUIMessageChunk,
} from "@/lib/thread-chat/contracts/ui-message"
import type {
  StreamSession,
  StreamSessionController,
  StreamSubscriber,
} from "@/lib/thread-chat/streaming/stream-session"

export interface SessionStoreOptions {
  now?: () => number
  terminalTtlMs?: number
  cleanupIntervalMs?: number
  startCleanupTimer?: boolean
  onTaskError?: (messageId: string, error: unknown) => void
}

export interface StartSessionInput {
  messageId: string
  initialSnapshot: ThreadChatUIMessage
  run: (session: StreamSessionController) => Promise<void>
}

export class SessionStore {
  readonly sessions = new Map<string, StreamSession>()
  private readonly now: () => number
  private readonly terminalTtlMs: number
  private readonly onTaskError: (messageId: string, error: unknown) => void
  private readonly cleanupTimer: ReturnType<typeof setInterval> | null

  constructor(options: SessionStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.terminalTtlMs =
      options.terminalTtlMs ?? THREAD_CHAT_SESSION_TERMINAL_TTL_MS
    this.onTaskError =
      options.onTaskError ??
      ((messageId, error) => {
        console.error(`[thread-chat] Session ${messageId} task failed`, error)
      })
    this.cleanupTimer =
      options.startCleanupTimer === false
        ? null
        : setInterval(
            () => this.cleanup(),
            options.cleanupIntervalMs ?? THREAD_CHAT_SESSION_CLEANUP_INTERVAL_MS
          )
    this.cleanupTimer?.unref?.()
  }

  get(messageId: string): StreamSession | null {
    return this.sessions.get(messageId) ?? null
  }

  start(input: StartSessionInput): {
    started: boolean
    session: StreamSession
  } {
    const existing = this.sessions.get(input.messageId)
    if (existing) return { started: false, session: existing }

    const session: StreamSession = {
      messageId: input.messageId,
      abortController: new AbortController(),
      subscribers: new Set(),
      status: "running",
      snapshot: structuredClone(input.initialSnapshot),
      eventSeq: 0,
      finishedAt: null,
      terminalMessage: null,
      task: null,
    }
    this.sessions.set(input.messageId, session)

    const controller = this.controllerFor(session)
    session.task = Promise.resolve()
      .then(() => input.run(controller))
      .catch((error) => this.onTaskError(session.messageId, error))
    return { started: true, session }
  }

  subscribe(messageId: string, subscriber: StreamSubscriber): () => void {
    const session = this.sessions.get(messageId)
    if (!session) throw new Error("SESSION_NOT_AVAILABLE")

    // 同一同步临界段内先注册，再发送覆盖既往事件的 snapshot。
    session.subscribers.add(subscriber)
    subscriber({
      type: "snapshot",
      message: structuredClone(session.snapshot),
      throughSeq: session.eventSeq,
    })
    if (session.terminalMessage) {
      subscriber({
        type: "terminal",
        message: structuredClone(session.terminalMessage),
      })
    }
    return () => session.subscribers.delete(subscriber)
  }

  abort(messageId: string, reason?: unknown): boolean {
    const session = this.sessions.get(messageId)
    if (!session || session.status !== "running") return false
    session.abortController.abort(reason)
    return true
  }

  discard(messageId: string, terminalMessage: MessageDTO): boolean {
    const session = this.sessions.get(messageId)
    if (!session) return false
    if (session.status === "running") session.abortController.abort("discarded")
    this.finish(session, terminalMessage)
    this.sessions.delete(messageId)
    return true
  }

  cleanup(): number {
    const now = this.now()
    let removed = 0
    for (const [messageId, session] of this.sessions) {
      if (
        session.status === "terminal" &&
        session.finishedAt !== null &&
        session.subscribers.size === 0 &&
        now - session.finishedAt >= this.terminalTtlMs
      ) {
        this.sessions.delete(messageId)
        removed += 1
      }
    }
    return removed
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
  }

  private controllerFor(session: StreamSession): StreamSessionController {
    return {
      messageId: session.messageId,
      signal: session.abortController.signal,
      getSnapshot: () => structuredClone(session.snapshot),
      publish: (chunk, snapshot) => this.publish(session, chunk, snapshot),
      replaceSnapshot: (snapshot) => {
        if (session.status === "running") {
          session.snapshot = structuredClone(snapshot)
        }
      },
      finish: (message, snapshot) => this.finish(session, message, snapshot),
    }
  }

  private publish(
    session: StreamSession,
    chunk: ThreadChatUIMessageChunk,
    snapshot: ThreadChatUIMessage
  ): void {
    if (session.status !== "running") return
    // snapshot 必须先覆盖当前 chunk，再提高 sequence 并广播。
    session.snapshot = structuredClone(snapshot)
    session.eventSeq += 1
    this.broadcast(session, {
      type: "chunk",
      seq: session.eventSeq,
      chunk: structuredClone(chunk),
    })
  }

  private finish(
    session: StreamSession,
    message: MessageDTO,
    snapshot?: ThreadChatUIMessage
  ): void {
    if (session.status === "terminal") return
    if (snapshot) session.snapshot = structuredClone(snapshot)
    session.status = "terminal"
    session.finishedAt = this.now()
    session.terminalMessage = structuredClone(message)
    this.broadcast(session, {
      type: "terminal",
      message: structuredClone(message),
    })
  }

  private broadcast(
    session: StreamSession,
    event: Parameters<StreamSubscriber>[0]
  ) {
    for (const subscriber of [...session.subscribers]) {
      try {
        subscriber(event)
      } catch (error) {
        session.subscribers.delete(subscriber)
        this.onTaskError(session.messageId, error)
      }
    }
  }
}

const SESSION_STORE_SYMBOL = Symbol.for("thread-chat.v1.session-store")
type GlobalSessionStore = typeof globalThis & {
  [SESSION_STORE_SYMBOL]?: SessionStore
}

export function getSessionStore(): SessionStore {
  const scope = globalThis as GlobalSessionStore
  scope[SESSION_STORE_SYMBOL] ??= new SessionStore()
  return scope[SESSION_STORE_SYMBOL]
}
