"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"
import type { ComposerAttachmentDraft } from "@/lib/thread-chat/composer-attachments"

export interface ComposerDraftEntry {
  draft: ThreadComposerDraft
  revision: number
}

export function createComposerDraftStore() {
  return createStore<{
    entries: Record<string, ComposerDraftEntry>
    attachments: Record<string, ComposerAttachmentDraft[]>
  }>(() => ({ entries: {}, attachments: {} }))
}
type DraftStore = ReturnType<typeof createComposerDraftStore>
const DraftContext = createContext<DraftStore | null>(null)

export function ComposerDraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createComposerDraftStore)
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>
}

export function useComposerDraftStore() {
  const context = useContext(DraftContext)
  if (!context) throw new Error("ComposerDraftProvider 未挂载")
  return context
}

export function useComposerDraft(scope: string, initial: () => ThreadComposerDraft) {
  const store = useComposerDraftStore()
  const [fallback] = useState<ComposerDraftEntry>(() => ({ draft: initial(), revision: 0 }))
  const entry = useStore(store, (state) => state.entries[scope] ?? fallback)
  function update(draft: ThreadComposerDraft, reset = false) {
    store.setState((state) => ({ entries: { ...state.entries, [scope]: {
      draft, revision: (state.entries[scope]?.revision ?? 0) + (reset ? 1 : 0),
    } } }))
  }
  function clearSubmitted(submitted: ThreadComposerDraft) {
    const current = store.getState().entries[scope]?.draft ?? fallback.draft
    if (current === submitted) update({ parts: [] }, true)
  }
  function resolveUpload(localId: string, file: import("@/lib/thread-chat/contracts/message-content").FileReference) {
    const current = store.getState().entries[scope]?.draft ?? fallback.draft
    update({ parts: current.parts.map((part) => part.localId === localId && part.type === "upload" ? { localId, type: "file", file } : part) })
  }
  function failUpload(localId: string, error: string) {
    const current = store.getState().entries[scope]?.draft ?? fallback.draft
    update({ parts: current.parts.map((part) => part.localId === localId && part.type === "upload" ? { ...part, error } : part) })
  }
  return { entry, update, clearSubmitted, resolveUpload, failUpload }
}
