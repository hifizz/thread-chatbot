import type { StoreApi } from "zustand/vanilla"
import type { ThreadChatApiCapabilities } from "../api/capabilities"
import { artifactSchema, threadMessageBundleSchema } from "../api/contracts"
import { isAbortError, normalizeClientError, clientInvariant } from "./errors"
import type {
  ArtifactLoader,
  GenerationCoordinator,
  ThreadChatProjectStore,
  ThreadMessageLoader,
} from "./types"

export function createThreadMessageLoader(input: {
  projectId: string
  api: ThreadChatApiCapabilities
  store: StoreApi<ThreadChatProjectStore>
  generationCoordinator: GenerationCoordinator
}): ThreadMessageLoader {
  const inFlight = new Map<string, Promise<void>>()
  const controllers = new Map<string, AbortController>()
  let disposed = false

  return {
    ensure(threadId) {
      const state = input.store.getState()
      clientInvariant(
        state.entities.threadsById[threadId]?.projectId === input.projectId,
        "Thread loader target belongs to another Project."
      )
      if (
        state.requests.threadMessagesById[threadId]?.loadState.status ===
        "ready"
      )
        return Promise.resolve()
      const existing = inFlight.get(threadId)
      if (existing) return existing

      state.setThreadMessageLoadState(threadId, { status: "loading" })
      const controller = new AbortController()
      controllers.set(threadId, controller)
      const request = input.api
        .loadThreadMessages({ threadId, signal: controller.signal })
        .then((rawBundle) => {
          if (disposed) return
          const bundle = threadMessageBundleSchema.parse(rawBundle)
          clientInvariant(
            bundle.threadId === threadId,
            "Thread loader response identity mismatch."
          )
          input.store.getState().applyMessageBundle(bundle)
          input.generationCoordinator.resumeLoadedRuns()
        })
        .catch((error: unknown) => {
          if (disposed || isAbortError(error)) return
          input.store.getState().setThreadMessageLoadState(threadId, {
            status: "error",
            error: normalizeClientError(error),
          })
        })
        .finally(() => {
          inFlight.delete(threadId)
          controllers.delete(threadId)
        })
      inFlight.set(threadId, request)
      return request
    },
    destroy() {
      disposed = true
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      inFlight.clear()
    },
  }
}

export function createArtifactLoader(input: {
  projectId: string
  api: ThreadChatApiCapabilities
  store: StoreApi<ThreadChatProjectStore>
}): ArtifactLoader {
  const inFlight = new Map<string, Promise<void>>()
  const controllers = new Map<string, AbortController>()
  let disposed = false

  return {
    ensure(artifactId) {
      const state = input.store.getState()
      if (state.entities.artifactsById[artifactId]) return Promise.resolve()
      const existing = inFlight.get(artifactId)
      if (existing) return existing
      state.setArtifactLoadState(artifactId, { status: "loading" })
      const controller = new AbortController()
      controllers.set(artifactId, controller)
      const request = input.api
        .loadArtifact(artifactId, controller.signal)
        .then((rawArtifact) => {
          if (disposed) return
          const artifact = artifactSchema.parse(rawArtifact)
          clientInvariant(
            artifact.id === artifactId &&
              artifact.projectId === input.projectId,
            "Artifact loader response identity mismatch."
          )
          input.store.getState().applyArtifact(artifact)
        })
        .catch((error: unknown) => {
          if (disposed || isAbortError(error)) return
          input.store.getState().setArtifactLoadState(artifactId, {
            status: "error",
            error: normalizeClientError(error),
          })
        })
        .finally(() => {
          inFlight.delete(artifactId)
          controllers.delete(artifactId)
        })
      inFlight.set(artifactId, request)
      return request
    },
    destroy() {
      disposed = true
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      inFlight.clear()
    },
  }
}
