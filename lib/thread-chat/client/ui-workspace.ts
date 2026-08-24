import type {
  ConversationId,
  ConversationThread,
  ThreadId,
} from "../domain/conversation-model.ts"

export const CONVERSATION_UI_WORKSPACE_SCHEMA_VERSION = 1 as const

export type ConversationColumnPolicy = "replace" | "fold"
export type ConversationViewMode = "columns" | "canvas"

/** 纯展示状态。这里的任何字段都不得参与领域 revision 或命令载荷。 */
export interface ConversationUiWorkspace {
  readonly schemaVersion: typeof CONVERSATION_UI_WORKSPACE_SCHEMA_VERSION
  readonly conversationId: ConversationId
  readonly visibleThreadIds: readonly ThreadId[]
  readonly foldedThreadIds: readonly ThreadId[]
  readonly selectedThreadId: ThreadId | null
  readonly forcedColumnCount: number | null
  readonly columnPolicy: ConversationColumnPolicy
  readonly columnWidthsByThreadId: Readonly<Record<string, number>>
  readonly viewMode: ConversationViewMode
  readonly canvasViewport: Readonly<{ x: number; y: number; zoom: number }>
  readonly openPanels: readonly string[]
  readonly draftsByThreadId: Readonly<Record<string, string>>
  readonly localHints: Readonly<Record<string, boolean>>
}

export interface ConversationUiWorkspaceStore {
  readonly getState: () => ConversationUiWorkspace
  readonly getVersion: () => number
  readonly subscribe: (listener: () => void) => () => void
  readonly update: (
    update: (current: ConversationUiWorkspace) => ConversationUiWorkspace
  ) => void
  readonly hydrate: (state: ConversationUiWorkspace) => void
  readonly openThread: (threadId: ThreadId) => void
  readonly closeThread: (threadId: ThreadId) => void
  readonly foldThread: (threadId: ThreadId, folded: boolean) => void
  readonly selectThread: (threadId: ThreadId | null) => void
  readonly setDraft: (threadId: ThreadId, value: string) => void
  readonly reconcileThreads: (
    threads: Readonly<Record<string, ConversationThread>>,
    rootThreadId: ThreadId
  ) => void
}

export function defaultConversationUiWorkspace(input: {
  readonly conversationId: ConversationId
  readonly rootThreadId: ThreadId
}): ConversationUiWorkspace {
  return {
    schemaVersion: CONVERSATION_UI_WORKSPACE_SCHEMA_VERSION,
    conversationId: input.conversationId,
    visibleThreadIds: [input.rootThreadId],
    foldedThreadIds: [],
    selectedThreadId: input.rootThreadId,
    forcedColumnCount: null,
    columnPolicy: "replace",
    columnWidthsByThreadId: {},
    viewMode: "columns",
    canvasViewport: { x: 0, y: 0, zoom: 1 },
    openPanels: [],
    draftsByThreadId: {},
    localHints: {},
  }
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function normalizeWorkspace(
  value: ConversationUiWorkspace
): ConversationUiWorkspace {
  return {
    ...value,
    visibleThreadIds: unique(value.visibleThreadIds),
    foldedThreadIds: unique(value.foldedThreadIds).filter((id) =>
      value.visibleThreadIds.includes(id)
    ),
    openPanels: unique(value.openPanels),
    canvasViewport: { ...value.canvasViewport },
    columnWidthsByThreadId: { ...value.columnWidthsByThreadId },
    draftsByThreadId: { ...value.draftsByThreadId },
    localHints: { ...value.localHints },
  }
}

export function createConversationUiWorkspaceStore(
  seed: ConversationUiWorkspace
): ConversationUiWorkspaceStore {
  let state = normalizeWorkspace(seed)
  let version = 0
  const listeners = new Set<() => void>()
  const commit = (next: ConversationUiWorkspace) => {
    if (next.conversationId !== state.conversationId)
      throw new Error("UI Workspace 不能切换 Conversation 身份")
    state = normalizeWorkspace(next)
    version += 1
    for (const listener of listeners) listener()
  }
  return {
    getState: () => state,
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(update) {
      commit(update(state))
    },
    hydrate(next) {
      commit(next)
    },
    openThread(targetThreadId) {
      commit({
        ...state,
        visibleThreadIds: unique([...state.visibleThreadIds, targetThreadId]),
        foldedThreadIds: state.foldedThreadIds.filter(
          (id) => id !== targetThreadId
        ),
        selectedThreadId: targetThreadId,
      })
    },
    closeThread(targetThreadId) {
      const visible = state.visibleThreadIds.filter(
        (id) => id !== targetThreadId
      )
      commit({
        ...state,
        visibleThreadIds: visible,
        foldedThreadIds: state.foldedThreadIds.filter(
          (id) => id !== targetThreadId
        ),
        selectedThreadId:
          state.selectedThreadId === targetThreadId
            ? (visible.at(-1) ?? null)
            : state.selectedThreadId,
      })
    },
    foldThread(targetThreadId, folded) {
      commit({
        ...state,
        foldedThreadIds: folded
          ? unique([...state.foldedThreadIds, targetThreadId])
          : state.foldedThreadIds.filter((id) => id !== targetThreadId),
      })
    },
    selectThread(selectedThreadId) {
      commit({ ...state, selectedThreadId })
    },
    setDraft(targetThreadId, value) {
      const drafts = { ...state.draftsByThreadId }
      if (value) drafts[targetThreadId] = value
      else delete drafts[targetThreadId]
      commit({ ...state, draftsByThreadId: drafts })
    },
    reconcileThreads(threads, rootThreadId) {
      const active = new Set(
        Object.values(threads)
          .filter((thread) => thread.lifecycle === "active")
          .map((thread) => thread.id)
      )
      active.add(rootThreadId)
      const visible = state.visibleThreadIds.filter((id) => active.has(id))
      if (!visible.includes(rootThreadId)) visible.unshift(rootThreadId)
      const selected =
        state.selectedThreadId && active.has(state.selectedThreadId)
          ? state.selectedThreadId
          : (visible.at(-1) ?? rootThreadId)
      commit({
        ...state,
        visibleThreadIds: visible,
        foldedThreadIds: state.foldedThreadIds.filter((id) => active.has(id)),
        selectedThreadId: selected,
      })
    },
  }
}

export function serializeConversationUiWorkspace(
  state: ConversationUiWorkspace
): string {
  return JSON.stringify(normalizeWorkspace(state))
}

export function parseConversationUiWorkspace(input: {
  readonly raw: string | null
  readonly conversationId: ConversationId
  readonly rootThreadId: ThreadId
  readonly threads: Readonly<Record<string, ConversationThread>>
}): ConversationUiWorkspace {
  const fallback = defaultConversationUiWorkspace(input)
  if (!input.raw) return fallback
  try {
    const value = JSON.parse(input.raw) as Partial<ConversationUiWorkspace>
    if (
      value.schemaVersion !== CONVERSATION_UI_WORKSPACE_SCHEMA_VERSION ||
      value.conversationId !== input.conversationId ||
      !Array.isArray(value.visibleThreadIds) ||
      !Array.isArray(value.foldedThreadIds)
    )
      return fallback
    const active = new Set(
      Object.values(input.threads)
        .filter((thread) => thread.lifecycle === "active")
        .map((thread) => thread.id)
    )
    active.add(input.rootThreadId)
    const visible = unique(
      value.visibleThreadIds.filter(
        (candidate): candidate is ThreadId =>
          typeof candidate === "string" && active.has(candidate as ThreadId)
      )
    )
    if (!visible.includes(input.rootThreadId))
      visible.unshift(input.rootThreadId)
    const folded = unique(
      value.foldedThreadIds.filter(
        (candidate): candidate is ThreadId =>
          typeof candidate === "string" &&
          visible.includes(candidate as ThreadId)
      )
    )
    const selected =
      typeof value.selectedThreadId === "string" &&
      active.has(value.selectedThreadId as ThreadId)
        ? (value.selectedThreadId as ThreadId)
        : (visible.at(-1) ?? input.rootThreadId)
    return normalizeWorkspace({
      ...fallback,
      ...value,
      schemaVersion: CONVERSATION_UI_WORKSPACE_SCHEMA_VERSION,
      conversationId: input.conversationId,
      visibleThreadIds: visible,
      foldedThreadIds: folded,
      selectedThreadId: selected,
      columnPolicy:
        value.columnPolicy === "fold" || value.columnPolicy === "replace"
          ? value.columnPolicy
          : fallback.columnPolicy,
      viewMode: value.viewMode === "canvas" ? "canvas" : "columns",
      canvasViewport:
        value.canvasViewport &&
        Number.isFinite(value.canvasViewport.x) &&
        Number.isFinite(value.canvasViewport.y) &&
        Number.isFinite(value.canvasViewport.zoom)
          ? value.canvasViewport
          : fallback.canvasViewport,
      openPanels: Array.isArray(value.openPanels)
        ? value.openPanels.filter(
            (panel): panel is string => typeof panel === "string"
          )
        : [],
      draftsByThreadId:
        value.draftsByThreadId && typeof value.draftsByThreadId === "object"
          ? Object.fromEntries(
              Object.entries(value.draftsByThreadId).filter(
                ([targetThreadId, draft]) =>
                  active.has(targetThreadId as ThreadId) &&
                  typeof draft === "string"
              )
            )
          : {},
      localHints:
        value.localHints && typeof value.localHints === "object"
          ? Object.fromEntries(
              Object.entries(value.localHints).filter(
                ([, shown]) => typeof shown === "boolean"
              )
            )
          : {},
    } as ConversationUiWorkspace)
  } catch {
    return fallback
  }
}
