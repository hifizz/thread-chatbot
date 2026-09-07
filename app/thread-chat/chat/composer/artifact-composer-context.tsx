"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { createStore, useStore } from "zustand"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { InlineComposerPart } from "@/lib/thread-chat/contracts/artifact-reference"
import type { ThreadComposerAttachment } from "./thread-attachment-model"
import type { ThreadQuoteDataV1 } from "@/lib/thread-chat/contracts/quote"

interface ComposerState {
  parts: InlineComposerPart[]
  attachments: ThreadComposerAttachment[]
  quotes: ThreadQuoteDataV1[]
  focusRequest?: number
}
const EMPTY_DRAFT: ComposerState = { parts: [], attachments: [], quotes: [] }
function createDraftStore() {
  return createStore<{ drafts: Record<string, ComposerState> }>(() => ({ drafts: {} }))
}
const ArtifactComposerContext = createContext<{
  artifacts: ArtifactDTO[]
  openArtifact(id: string): void
  drafts: ReturnType<typeof createDraftStore>
} | null>(null)

export function ArtifactComposerProvider({ artifacts, openArtifact, children }: {
  artifacts: ArtifactDTO[]
  openArtifact(id: string): void
  children: ReactNode
}) {
  const [drafts] = useState(createDraftStore)
  return <ArtifactComposerContext.Provider value={{ artifacts, openArtifact, drafts }}>
    {children}
  </ArtifactComposerContext.Provider>
}

export function useArtifactResources() {
  return useContext(ArtifactComposerContext)
}

/** Provider 按 Project 挂载，草稿按 Thread 隔离；列与画布共享同一个 store。 */
export function useArtifactComposerDraft(threadId: string) {
  const context = useArtifactResources()
  const [fallback] = useState(createDraftStore)
  const store = context?.drafts ?? fallback
  const draft = useStore(store, (state) => state.drafts[threadId] ?? EMPTY_DRAFT)
  const update = useCallback((fn: (current: ComposerState) => ComposerState) => {
    store.setState((state) => ({ drafts: {
      ...state.drafts,
      [threadId]: fn(state.drafts[threadId] ?? EMPTY_DRAFT),
    } }))
  }, [store, threadId])
  return { draft, update }
}
