"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useStore } from "zustand"
import type { ConversationStore } from "../../core/store"

const ResourceContext = createContext<ConversationStore | null>(null)
const ArtifactNavigationContext = createContext<((id: string) => void) | null>(null)

export function ArtifactResourcesProvider({ store, children }: { store: ConversationStore; children: ReactNode }) {
  return <ResourceContext.Provider value={store}>{children}</ResourceContext.Provider>
}
export function ArtifactNavigationProvider({ onOpen, children }: { onOpen: (id: string) => void; children: ReactNode }) {
  return <ArtifactNavigationContext.Provider value={onOpen}>{children}</ArtifactNavigationContext.Provider>
}
export function useArtifactNavigation() { return useContext(ArtifactNavigationContext) }
export function useArtifactResources() {
  const store = useContext(ResourceContext)
  if (!store) throw new Error("ArtifactResourcesProvider 未挂载")
  return useStore(store, (state) => state.artifactsById)
}
export function useComposerThread(threadId: string) {
  const store = useContext(ResourceContext)
  if (!store) throw new Error("ArtifactResourcesProvider 未挂载")
  return useStore(store, (state) => state.threadsById[threadId === "main" ? state.project?.rootThreadId ?? threadId : threadId])
}
