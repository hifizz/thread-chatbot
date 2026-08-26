import type { ThreadTreeReadableStore } from "./use-thread-store"
import type { ConversationStore } from "./store"
import {
  fromConversationViewThreadId,
  projectConversationTree,
} from "./projections"

export interface ProjectedConversationStore extends ThreadTreeReadableStore {
  touch(viewThreadId: string): void
  dispose(): void
}

/** Read-only UI facade for components that still consume the established tree view model. */
export function createProjectedConversationStore(input: {
  store: ConversationStore
  setThreadModel(threadId: string, modelId: string): void
  emptyRootModelId?: string
}): ProjectedConversationStore {
  let version = 0
  const listeners = new Set<() => void>()
  const unsubscribe = input.store.subscribe(() => {
    version += 1
    listeners.forEach((listener) => listener())
  })

  return {
    getState: () => {
      const state = input.store.getState()
      const tree = projectConversationTree(state)
      if (!state.project && input.emptyRootModelId)
        tree.threads.main.modelId = input.emptyRootModelId
      return tree
    },
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    touch(viewThreadId) {
      const state = input.store.getState()
      const threadId = fromConversationViewThreadId(state, viewThreadId)
      if (!state.threadsById[threadId]) return
      state.setWorkspace({
        selectedThreadId: threadId,
        recents: [
          threadId,
          ...state.workspace.recents.filter((id) => id !== threadId),
        ].slice(0, 6),
      })
    },
    setThreadModel(viewThreadId, modelId) {
      const state = input.store.getState()
      input.setThreadModel(
        fromConversationViewThreadId(state, viewThreadId),
        modelId
      )
    },
    dispose: unsubscribe,
  }
}
