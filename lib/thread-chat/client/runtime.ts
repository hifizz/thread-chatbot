import { createStore } from "zustand/vanilla"
import { JsonThreadChatTransport } from "../api/json-transport"
import { createThreadChatAppStore } from "./app-store"
import {
  createThreadChatAppCommands,
  createThreadChatProjectCommands,
} from "./commands"
import { clientInvariant } from "./errors"
import { createGenerationCoordinator } from "./generation-coordinator"
import { createArtifactLoader, createThreadMessageLoader } from "./loaders"
import { createThreadChatProjectStore } from "./project-store"
import type {
  CreationBundle,
  ListProjectsResult,
  NavigationCapability,
  NewProjectDraftStore,
  ProjectRuntimeRegistry,
  ThreadChatAppRuntime,
  ThreadChatProjectRuntime,
} from "./types"
import type { ThreadChatApiCapabilities } from "../api/capabilities"

export function createNewProjectDraftStore(initialRequestedModelId?: string) {
  return createStore<NewProjectDraftStore>()((set) => ({
    draftParts: [],
    requestedModelId: initialRequestedModelId,
    status: "idle",
    error: null,
    setDraftParts(draftParts) {
      set({ draftParts })
    },
    setRequestedModelId(requestedModelId) {
      set({ requestedModelId })
    },
    markSubmitting() {
      set({ status: "submitting", error: null })
    },
    markError(error) {
      set({ status: "error", error })
    },
    markIdle() {
      set({ status: "idle", error: null })
    },
  }))
}

export function createThreadChatProjectRuntime(input: {
  projectId: string
  api: ThreadChatApiCapabilities
  generateSlotId?: () => string
  scheduleFlush?: (callback: () => void) => () => void
  waitForReconnect?: (signal: AbortSignal) => Promise<void>
}): ThreadChatProjectRuntime {
  const store = createThreadChatProjectStore({
    projectId: input.projectId,
    generateSlotId: input.generateSlotId,
  })
  const generationCoordinator = createGenerationCoordinator({
    api: input.api,
    store,
    scheduleFlush: input.scheduleFlush,
    waitForReconnect: input.waitForReconnect,
  })
  const messageLoader = createThreadMessageLoader({
    projectId: input.projectId,
    api: input.api,
    store,
    generationCoordinator,
  })
  const artifactLoader = createArtifactLoader({
    projectId: input.projectId,
    api: input.api,
    store,
  })
  const projectCommands = createThreadChatProjectCommands({
    projectId: input.projectId,
    api: input.api,
    store,
    messageLoader,
    artifactLoader,
    generationCoordinator,
  })
  let disposed = false
  return {
    projectId: input.projectId,
    store,
    commands: projectCommands.commands,
    messageLoader,
    artifactLoader,
    generationCoordinator,
    destroy() {
      if (disposed) return
      disposed = true
      projectCommands.destroy()
      messageLoader.destroy()
      artifactLoader.destroy()
      generationCoordinator.destroy()
    },
  }
}

export function createProjectRuntimeRegistry(input: {
  createRuntime(projectId: string): ThreadChatProjectRuntime
}): ProjectRuntimeRegistry {
  const entries = new Map<
    string,
    {
      runtime: ThreadChatProjectRuntime
      leased: boolean
      handoff: boolean
    }
  >()

  return {
    seedFromCreation(bundle: CreationBundle) {
      let entry = entries.get(bundle.project.id)
      if (!entry) {
        entry = {
          runtime: input.createRuntime(bundle.project.id),
          leased: false,
          handoff: true,
        }
        entries.set(bundle.project.id, entry)
      } else {
        clientInvariant(
          entry.runtime.store.getState().entities.project === null,
          "Cannot seed an initialized Project Runtime."
        )
        entry.handoff = true
      }
      entry.runtime.store.getState().mergeCreationBundle(bundle)
      return entry.runtime
    },
    acquire(projectId) {
      let entry = entries.get(projectId)
      if (!entry) {
        entry = {
          runtime: input.createRuntime(projectId),
          leased: true,
          handoff: false,
        }
        entries.set(projectId, entry)
      } else {
        entry.leased = true
        entry.handoff = false
      }
      return entry.runtime
    },
    release(projectId) {
      const entry = entries.get(projectId)
      if (!entry) return
      entry.leased = false
      queueMicrotask(() => {
        if (
          entries.get(projectId) === entry &&
          !entry.leased &&
          !entry.handoff
        ) {
          entry.runtime.destroy()
          entries.delete(projectId)
        }
      })
    },
    peek(projectId) {
      return entries.get(projectId)?.runtime ?? null
    },
    destroy() {
      for (const entry of entries.values()) entry.runtime.destroy()
      entries.clear()
    },
  }
}

export function createThreadChatAppRuntime(input: {
  api?: ThreadChatApiCapabilities
  navigation: NavigationCapability
  initialCatalog?: ListProjectsResult
  createProjectRuntime?: (
    projectId: string,
    api: ThreadChatApiCapabilities
  ) => ThreadChatProjectRuntime
}): ThreadChatAppRuntime {
  const api = input.api ?? new JsonThreadChatTransport()
  const appStore = createThreadChatAppStore(input.initialCatalog)
  const registry = createProjectRuntimeRegistry({
    createRuntime: (projectId) =>
      input.createProjectRuntime?.(projectId, api) ??
      createThreadChatProjectRuntime({ projectId, api }),
  })
  const appCommands = createThreadChatAppCommands({
    api,
    store: appStore,
    navigation: input.navigation,
  })
  let disposed = false
  return {
    appStore,
    projectRuntimeRegistry: registry,
    api,
    commands: appCommands.commands,
    navigation: input.navigation,
    destroy() {
      if (disposed) return
      disposed = true
      appCommands.destroy()
      registry.destroy()
    },
  }
}
