import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"

const DRAFT_STORAGE_PREFIX = "thread-draft:"
const DRAFT_SAVE_DELAY_MS = 400

const pendingDrafts = new Map<string, ThreadComposerDraft>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function storageKey(scope: string) {
  return `${DRAFT_STORAGE_PREFIX}${scope}`
}

function persistDraft(scope: string, draft: ThreadComposerDraft) {
  try {
    if (draft.parts.length === 0) localStorage.removeItem(storageKey(scope))
    else localStorage.setItem(storageKey(scope), JSON.stringify(draft))
  } catch {
    // localStorage 不可用或配额不足时退化为当前会话内存草稿。
  }
}

export function readStoredDraft(scope: string): ThreadComposerDraft | null {
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

export function flushStoredDraft(scope: string) {
  const timer = saveTimers.get(scope)
  if (timer) clearTimeout(timer)
  saveTimers.delete(scope)

  const draft = pendingDrafts.get(scope)
  if (!draft) return
  pendingDrafts.delete(scope)
  persistDraft(scope, draft)
}

export function scheduleStoredDraft(scope: string, draft: ThreadComposerDraft) {
  pendingDrafts.set(scope, draft)
  const timer = saveTimers.get(scope)
  if (timer) clearTimeout(timer)
  saveTimers.set(scope, setTimeout(() => flushStoredDraft(scope), DRAFT_SAVE_DELAY_MS))
}

export function clearStoredDraft(scope: string) {
  const timer = saveTimers.get(scope)
  if (timer) clearTimeout(timer)
  saveTimers.delete(scope)
  pendingDrafts.delete(scope)
  try { localStorage.removeItem(storageKey(scope)) } catch {}
}

export function flushAllStoredDrafts() {
  for (const scope of pendingDrafts.keys()) flushStoredDraft(scope)
}
