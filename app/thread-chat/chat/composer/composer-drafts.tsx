"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"
import type { ThreadQuoteDataV1 } from "@/lib/thread-chat/contracts/quote"
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"
import type { ComposerAttachmentDraft } from "@/lib/thread-chat/composer-attachments"

const DRAFT_STORAGE_PREFIX = "thread-draft:"
const DRAFT_SAVE_DELAY_MS = 400

const pendingDrafts = new Map<string, ThreadComposerDraft>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function storageKey(scope: string) {
  return `${DRAFT_STORAGE_PREFIX}${scope}`
}

function readStoredDraft(scope: string): ThreadComposerDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ThreadComposerDraft>
    if (!Array.isArray(parsed.parts)) return null
    return { parts: parsed.parts as ThreadComposerDraft["parts"] }
  } catch {
    return null
  }
}

function persistDraft(scope: string, draft: ThreadComposerDraft) {
  try {
    if (draft.parts.length === 0) localStorage.removeItem(storageKey(scope))
    else localStorage.setItem(storageKey(scope), JSON.stringify(draft))
  } catch {
    // localStorage 不可用或配额不足时退化为当前会话内存草稿。
  }
}

function flushDraft(scope: string) {
  const timer = saveTimers.get(scope)
  if (timer) clearTimeout(timer)
  saveTimers.delete(scope)

  const draft = pendingDrafts.get(scope)
  if (!draft) return
  pendingDrafts.delete(scope)
  persistDraft(scope, draft)
}

function scheduleDraftSave(scope: string, draft: ThreadComposerDraft) {
  pendingDrafts.set(scope, draft)
  const timer = saveTimers.get(scope)
  if (timer) clearTimeout(timer)
  saveTimers.set(scope, setTimeout(() => flushDraft(scope), DRAFT_SAVE_DELAY_MS))
}

function clearStoredDraft(scope: string) {
  const timer = saveTimers.get(scope)
  if (timer) clearTimeout(timer)
  saveTimers.delete(scope)
  pendingDrafts.delete(scope)
  try { localStorage.removeItem(storageKey(scope)) } catch {}
}

export interface ComposerDraftEntry {
  draft: ThreadComposerDraft
  revision: number
}

export function createComposerDraftStore() {
  return createStore<{
    entries: Record<string, ComposerDraftEntry>
    quoteRequests: Record<string, ThreadQuoteDataV1[]>
    attachments: Record<string, ComposerAttachmentDraft[]>
  }>(() => ({ entries: {}, attachments: {}, quoteRequests: {} }))
}
type DraftStore = ReturnType<typeof createComposerDraftStore>
const DraftContext = createContext<DraftStore | null>(null)

export function ComposerDraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createComposerDraftStore)
  useEffect(() => {
    const flushPendingDrafts = () => {
      for (const scope of pendingDrafts.keys()) flushDraft(scope)
    }
    window.addEventListener("pagehide", flushPendingDrafts)
    return () => {
      window.removeEventListener("pagehide", flushPendingDrafts)
      flushPendingDrafts()
    }
  }, [])
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

  useEffect(() => {
    if (store.getState().entries[scope]) return
    const draft = readStoredDraft(scope) ?? fallback.draft
    store.setState((state) => ({
      entries: {
        ...state.entries,
        [scope]: { draft, revision: draft === fallback.draft ? 0 : 1 },
      },
    }))
  }, [fallback, scope, store])

  function update(draft: ThreadComposerDraft, reset = false) {
    store.setState((state) => ({ entries: { ...state.entries, [scope]: {
      draft, revision: (state.entries[scope]?.revision ?? 0) + (reset ? 1 : 0),
    } } }))
    if (reset) clearStoredDraft(scope)
    else scheduleDraftSave(scope, draft)
  }
  function clearSubmitted(submitted: ThreadComposerDraft) {
    const current = store.getState().entries[scope]?.draft ?? fallback.draft
    if (current === submitted) update({ parts: [] }, true)
  }
  return { entry, update, clearSubmitted }
}
