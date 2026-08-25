import type { StoreApi } from "zustand/vanilla"
import type { ThreadChatApiCapabilities } from "../api/capabilities"
import { assistantMessageEventSchema } from "../api/contracts"
import { isAbortError } from "./errors"
import type {
  AssistantMessageEvent,
  GenerationCoordinator,
  ThreadChatProjectStore,
} from "./types"

function defaultScheduleFlush(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(id)
  }
  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled) callback()
  })
  return () => {
    cancelled = true
  }
}

function defaultReconnectWait(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 250)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        resolve()
      },
      { once: true }
    )
  })
}

function isTerminal(event: AssistantMessageEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.stopped" ||
    (event.type === "run.snapshot" &&
      ["completed", "failed", "stopped"].includes(event.run.status))
  )
}

export function createGenerationCoordinator(input: {
  api: ThreadChatApiCapabilities
  store: StoreApi<ThreadChatProjectStore>
  scheduleFlush?: (callback: () => void) => () => void
  waitForReconnect?: (signal: AbortSignal) => Promise<void>
}): GenerationCoordinator {
  const controllers = new Map<string, AbortController>()
  const cancelFlushByMessageId = new Map<string, () => void>()
  const scheduleFlush = input.scheduleFlush ?? defaultScheduleFlush
  const waitForReconnect = input.waitForReconnect ?? defaultReconnectWait
  let disposed = false

  const scheduleMessageFlush = (assistantMessageId: string) => {
    if (cancelFlushByMessageId.has(assistantMessageId)) return
    cancelFlushByMessageId.set(
      assistantMessageId,
      scheduleFlush(() => {
        cancelFlushByMessageId.delete(assistantMessageId)
        if (!disposed) input.store.getState().flushRunBuffer(assistantMessageId)
      })
    )
  }

  const consume = async (
    assistantMessageId: string,
    controller: AbortController
  ) => {
    while (!disposed && !controller.signal.aborted) {
      const run =
        input.store.getState().runs.byAssistantMessageId[assistantMessageId]
      if (!run || ["completed", "failed", "stopped"].includes(run.status))
        return
      try {
        for await (const rawEvent of input.api.subscribeAssistantEvents({
          assistantMessageId,
          afterEventSequence: run.eventSequence,
          signal: controller.signal,
        })) {
          if (disposed || controller.signal.aborted) return
          const event = assistantMessageEventSchema.parse(rawEvent)
          input.store.getState().applyRunEvent(event, assistantMessageId)
          if (event.type === "run.delta")
            scheduleMessageFlush(assistantMessageId)
          if (isTerminal(event)) return
        }
      } catch (error) {
        if (disposed || controller.signal.aborted || isAbortError(error)) return
      }
      await waitForReconnect(controller.signal)
    }
  }

  const coordinator: GenerationCoordinator = {
    resumeLoadedRuns() {
      for (const run of Object.values(
        input.store.getState().runs.byAssistantMessageId
      ))
        if (run.status === "queued" || run.status === "running")
          coordinator.subscribeAssistant(run.assistantMessageId)
    },
    subscribeAssistant(assistantMessageId) {
      if (disposed || controllers.has(assistantMessageId)) return
      const run =
        input.store.getState().runs.byAssistantMessageId[assistantMessageId]
      if (!run || ["completed", "failed", "stopped"].includes(run.status))
        return
      const controller = new AbortController()
      controllers.set(assistantMessageId, controller)
      void consume(assistantMessageId, controller).finally(() => {
        if (controllers.get(assistantMessageId) === controller)
          controllers.delete(assistantMessageId)
      })
    },
    unsubscribeAssistant(assistantMessageId) {
      controllers.get(assistantMessageId)?.abort()
      controllers.delete(assistantMessageId)
      cancelFlushByMessageId.get(assistantMessageId)?.()
      cancelFlushByMessageId.delete(assistantMessageId)
    },
    destroy() {
      disposed = true
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      for (const cancel of cancelFlushByMessageId.values()) cancel()
      cancelFlushByMessageId.clear()
    },
  }
  return coordinator
}
