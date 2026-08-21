import type { CanonicalGenerationRecord } from "../application/conversation-generation-service"
import type { GenerationId } from "../domain/conversation-model"
import type { ConversationClientGateway } from "./conversation-client-gateway"
import type { NormalizedConversationStore } from "./normalized-conversation-store"

export interface GenerationCoordinatorScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

export interface GenerationCoordinator {
  readonly subscribe: (
    generationId: GenerationId,
    listener: () => void
  ) => () => void
  readonly setVisibility: (visibility: "visible" | "hidden") => void
  readonly ingest: (generation: CanonicalGenerationRecord) => void
  readonly monitoredCount: () => number
  readonly dispose: () => void
}

interface Monitor {
  readonly listeners: Set<() => void>
  timer: unknown | null
  querying: boolean
  disposed: boolean
}

const TERMINAL = new Set<CanonicalGenerationRecord["status"]>([
  "completed",
  "stopped",
  "failed",
  "superseded",
])

const browserScheduler: GenerationCoordinatorScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
}

export function createGenerationCoordinator(input: {
  readonly gateway: Pick<ConversationClientGateway, "getGeneration">
  readonly store: NormalizedConversationStore
  readonly scheduler?: GenerationCoordinatorScheduler
  readonly visiblePollMs?: number
  readonly hiddenPollMs?: number
}): GenerationCoordinator {
  const scheduler = input.scheduler ?? browserScheduler
  const visiblePollMs = input.visiblePollMs ?? 2_000
  const hiddenPollMs = input.hiddenPollMs ?? 10_000
  const monitors = new Map<GenerationId, Monitor>()
  let visibility: "visible" | "hidden" = "visible"
  let globallyDisposed = false

  const delay = () => (visibility === "visible" ? visiblePollMs : hiddenPollMs)

  const clearTimer = (monitor: Monitor) => {
    if (monitor.timer === null) return
    scheduler.clearTimeout(monitor.timer)
    monitor.timer = null
  }

  const schedule = (targetGenerationId: GenerationId, monitor: Monitor) => {
    clearTimer(monitor)
    if (globallyDisposed || monitor.disposed || monitor.listeners.size === 0)
      return
    monitor.timer = scheduler.setTimeout(() => {
      monitor.timer = null
      void query(targetGenerationId, monitor)
    }, delay())
  }

  const query = async (targetGenerationId: GenerationId, monitor: Monitor) => {
    if (
      globallyDisposed ||
      monitor.disposed ||
      monitor.querying ||
      monitor.listeners.size === 0
    )
      return
    monitor.querying = true
    try {
      const generation = await input.gateway.getGeneration(targetGenerationId)
      if (monitor.disposed) return
      input.store.mergeGeneration(generation)
      for (const listener of monitor.listeners) listener()
      if (TERMINAL.has(generation.status)) {
        clearTimer(monitor)
        return
      }
    } catch {
      // 暂时查询失败不改变规范状态；保留监控并按当前可见性重试。
    } finally {
      monitor.querying = false
    }
    schedule(targetGenerationId, monitor)
  }

  return {
    subscribe(targetGenerationId, listener) {
      if (globallyDisposed) throw new Error("GenerationCoordinator 已释放")
      let monitor = monitors.get(targetGenerationId)
      if (!monitor) {
        monitor = {
          listeners: new Set(),
          timer: null,
          querying: false,
          disposed: false,
        }
        monitors.set(targetGenerationId, monitor)
      }
      const wasEmpty = monitor.listeners.size === 0
      monitor.listeners.add(listener)
      if (wasEmpty) void query(targetGenerationId, monitor)
      return () => {
        const current = monitors.get(targetGenerationId)
        if (!current) return
        current.listeners.delete(listener)
        if (current.listeners.size > 0) return
        current.disposed = true
        clearTimer(current)
        monitors.delete(targetGenerationId)
        // 释放浏览器资源不是 Stop 命令，服务端 Generation 继续运行。
      }
    },
    setVisibility(nextVisibility) {
      if (visibility === nextVisibility) return
      visibility = nextVisibility
      for (const [targetGenerationId, monitor] of monitors)
        if (!monitor.querying) schedule(targetGenerationId, monitor)
    },
    ingest(generation) {
      const merged = input.store.mergeGeneration(generation)
      if (!merged.applied) return
      const monitor = monitors.get(generation.id)
      if (!monitor) return
      for (const listener of monitor.listeners) listener()
      if (TERMINAL.has(generation.status)) clearTimer(monitor)
    },
    monitoredCount: () => monitors.size,
    dispose() {
      globallyDisposed = true
      for (const monitor of monitors.values()) {
        monitor.disposed = true
        clearTimer(monitor)
      }
      monitors.clear()
    },
  }
}
