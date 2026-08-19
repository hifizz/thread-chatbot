import {
  GENERATION_CANCEL_POLL_MS,
  GENERATION_HEARTBEAT_MS,
} from "@/constants/generation"
import {
  getGenerationExecutionState,
  heartbeatGeneration,
} from "@/lib/thread-chat-generation/repository"

declare global {
  var __threadChatGenerationAbortControllers:
    | Map<string, AbortController>
    | undefined
}

const controllers =
  globalThis.__threadChatGenerationAbortControllers ??
  new Map<string, AbortController>()
if (process.env.NODE_ENV !== "production") {
  globalThis.__threadChatGenerationAbortControllers = controllers
}

export function registerGenerationController(
  generationId: string,
  controller: AbortController
) {
  controllers.set(generationId, controller)
}

export function unregisterGenerationController(
  generationId: string,
  controller: AbortController
) {
  if (controllers.get(generationId) === controller) {
    controllers.delete(generationId)
  }
}

export function abortGenerationLocally(generationId: string): boolean {
  const controller = controllers.get(generationId)
  if (!controller || controller.signal.aborted) return false
  controller.abort(new DOMException("Generation stopped by user", "AbortError"))
  return true
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function observeGenerationCancellation(
  generationId: string,
  controller: AbortController
) {
  let stopped = false
  const done = (async () => {
    let lastHeartbeat = Date.now()
    while (!stopped && !controller.signal.aborted) {
      await delay(GENERATION_CANCEL_POLL_MS)
      if (stopped || controller.signal.aborted) break
      try {
        const execution = await getGenerationExecutionState(generationId)
        if (
          !execution ||
          execution.status === "stop_requested" ||
          execution.status === "superseded" ||
          !execution.isCurrent
        ) {
          controller.abort(
            new DOMException("Generation stopped by server state", "AbortError")
          )
          break
        }
        if (Date.now() - lastHeartbeat >= GENERATION_HEARTBEAT_MS) {
          await heartbeatGeneration(generationId)
          lastHeartbeat = Date.now()
        }
      } catch (error) {
        console.error("[thread-chat-generation] 取消观察器查询失败", {
          generationId,
          error,
        })
      }
    }
  })()

  return {
    done,
    stop() {
      stopped = true
    },
  }
}

