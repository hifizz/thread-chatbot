import type {
  ArtifactEntity,
  MessageEntity,
  ProjectId,
  ThreadChatAppStore,
  ThreadChatProjectStore,
  ThreadColumnSlot,
} from "./types"

export const selectProjectCatalog = (state: ThreadChatAppStore) => state.catalog

export const selectAppShellUi = (state: ThreadChatAppStore) => state.shellUi

export function selectFilteredProjectIds(
  state: ThreadChatAppStore
): ProjectId[] {
  const query = state.shellUi.projectSearchQuery.trim().toLocaleLowerCase()
  if (!query) return state.catalog.orderedProjectIds
  return state.catalog.orderedProjectIds.filter((projectId) =>
    state.catalog.projectsById[projectId]?.displayTitle
      .toLocaleLowerCase()
      .includes(query)
  )
}

export const selectProject = (state: ThreadChatProjectStore) =>
  state.entities.project

export const selectProjectTarget = (state: ThreadChatProjectStore) =>
  state.entities.project?.target ?? null

export const selectThread = (state: ThreadChatProjectStore, threadId: string) =>
  state.entities.threadsById[threadId] ?? null

export const selectRootThread = (state: ThreadChatProjectStore) =>
  Object.values(state.entities.threadsById).find(
    (thread) => thread.parentThreadId === null
  ) ?? null

export function selectThreadMessages(
  state: ThreadChatProjectStore,
  threadId: string
): MessageEntity[] {
  return (state.entities.messageIdsByThreadId[threadId] ?? [])
    .map((messageId) => state.entities.messagesById[messageId])
    .filter(
      (message): message is MessageEntity =>
        Boolean(message) &&
        message.supersededAt === null &&
        !state.readModels.replacementSupersededMessageIds[message.id]
    )
}

export const selectAssistantRun = (
  state: ThreadChatProjectStore,
  assistantMessageId: string
) => state.runs.byAssistantMessageId[assistantMessageId] ?? null

export const selectArtifact = (
  state: ThreadChatProjectStore,
  artifactId: string
): ArtifactEntity | null => state.entities.artifactsById[artifactId] ?? null

export function selectSlotThreadId(
  state: ThreadChatProjectStore,
  slotId: "root" | string
): string | null {
  if (slotId === "root") return selectRootThread(state)?.id ?? null
  return (
    state.ui.columnSlots.find((slot) => slot.slotId === slotId)?.threadId ??
    null
  )
}

export function selectVisibleThreadColumns(state: ThreadChatProjectStore) {
  const root = selectRootThread(state)
  const rootColumn = root
    ? [{ slotId: "root" as const, threadId: root.id, folded: false }]
    : []
  return [
    ...rootColumn,
    ...state.ui.columnSlots.map((slot) => ({
      slotId: slot.slotId,
      threadId: slot.threadId,
      folded: slot.folded,
    })),
  ]
}

export function selectFocusedThreadId(
  state: ThreadChatProjectStore
): string | null {
  return state.ui.focusedSlotId
    ? selectSlotThreadId(state, state.ui.focusedSlotId)
    : null
}

export const selectFocusedColumnId = (state: ThreadChatProjectStore) =>
  state.ui.focusedSlotId

export function selectForkAvailability(
  state: ThreadChatProjectStore,
  messageId: string
): { allowed: true } | { allowed: false; reason: string } {
  const message = state.entities.messagesById[messageId]
  if (!message) return { allowed: false, reason: "message_not_loaded" }
  if (
    message.finalizedAt === null ||
    message.supersededAt !== null ||
    state.readModels.replacementSupersededMessageIds[messageId]
  )
    return { allowed: false, reason: "message_not_finalized" }
  if (message.role === "assistant") {
    const run = state.runs.byAssistantMessageId[messageId]
    if (run?.status !== "completed")
      return { allowed: false, reason: "assistant_run_not_completed" }
  }
  return { allowed: true }
}

export function selectArtifactIdsFromMessage(message: MessageEntity): string[] {
  if (!message.parts) return []
  const ids = new Set<string>()
  for (const part of message.parts) {
    const candidate = part as {
      type?: string
      output?: { artifactId?: unknown }
    }
    if (
      candidate.type === "dynamic-tool" &&
      typeof candidate.output?.artifactId === "string"
    )
      ids.add(candidate.output.artifactId)
  }
  return [...ids]
}

export function selectThreadColumnView(
  state: ThreadChatProjectStore,
  slotId: "root" | string
) {
  const threadId = selectSlotThreadId(state, slotId)
  if (!threadId) return { status: "loading" as const, slotId, threadId: null }
  const window = state.requests.threadMessagesById[threadId]
  if (
    !window ||
    window.loadState.status === "idle" ||
    window.loadState.status === "loading"
  )
    return { status: "loading" as const, slotId, threadId }
  if (window.loadState.status === "error")
    return {
      status: "error" as const,
      slotId,
      threadId,
      error: window.loadState.error,
      canRetry: true as const,
    }
  const messages = selectThreadMessages(state, threadId)
  return {
    status: "ready" as const,
    slotId,
    threadId,
    thread: state.entities.threadsById[threadId],
    messages,
    runs: Object.fromEntries(
      messages
        .filter((message) => message.role === "assistant")
        .map((message) => [
          message.id,
          state.runs.byAssistantMessageId[message.id] ?? null,
        ])
    ),
    artifactIds: [...new Set(messages.flatMap(selectArtifactIdsFromMessage))],
    hasOlderMessages: window.hasOlderMessages,
  }
}

export function selectThreadColumnHeaderView(
  state: ThreadChatProjectStore,
  slotId: "root" | string
) {
  const threadId = selectSlotThreadId(state, slotId)
  const thread = threadId ? state.entities.threadsById[threadId] : null
  const slot: ThreadColumnSlot | undefined =
    slotId === "root"
      ? undefined
      : state.ui.columnSlots.find((candidate) => candidate.slotId === slotId)
  const childCount = threadId
    ? Object.values(state.entities.threadsById).filter(
        (candidate) => candidate.parentThreadId === threadId
      ).length
    : 0
  return {
    slotId,
    threadId,
    title:
      slotId === "root"
        ? (state.entities.project?.customTitle ??
          state.entities.project?.autoTitle ??
          "")
        : (thread?.customTitle ?? thread?.autoTitle ?? ""),
    folded: slot?.folded ?? false,
    childCount,
    focused: state.ui.focusedSlotId === slotId,
  }
}

export function selectProjectTreeRows(state: ThreadChatProjectStore) {
  const threads = Object.values(state.entities.threadsById)
  const childrenByParent = new Map<string | null, typeof threads>()
  for (const thread of threads) {
    const siblings = childrenByParent.get(thread.parentThreadId) ?? []
    siblings.push(thread)
    childrenByParent.set(thread.parentThreadId, siblings)
  }
  const rows: Array<{
    threadId: string
    parentThreadId: string | null
    depth: number
    title: string
    archived: boolean
  }> = []
  const visit = (parentThreadId: string | null, depth: number) => {
    for (const thread of (childrenByParent.get(parentThreadId) ?? []).toSorted(
      (left, right) => left.createdAt.localeCompare(right.createdAt)
    )) {
      rows.push({
        threadId: thread.id,
        parentThreadId: thread.parentThreadId,
        depth,
        title:
          thread.parentThreadId === null
            ? (state.entities.project?.customTitle ??
              state.entities.project?.autoTitle ??
              "")
            : (thread.customTitle ?? thread.autoTitle ?? ""),
        archived: thread.archivedAt !== null,
      })
      visit(thread.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

export function selectProjectHeaderView(state: ThreadChatProjectStore) {
  const project = state.entities.project
  return {
    title: project?.customTitle ?? project?.autoTitle ?? "",
    archived: project?.archivedAt !== null && project !== null,
    artifactSummary: state.readModels.artifactSummary,
    focusedThreadId: selectFocusedThreadId(state),
  }
}
