import { createStore } from "zustand/vanilla"
import { clientInvariant } from "./errors"
import {
  mergeArtifactSummary,
  normalizeMessages,
  normalizeRuns,
  normalizeThreads,
} from "./normalizer"
import type {
  AssistantMessageEvent,
  AssistantRunState,
  MessageEntity,
  ThreadChatProjectState,
  ThreadChatProjectStore,
  ThreadColumnSlot,
  ThreadId,
  ThreadWorkbenchSnapshotV1,
} from "./types"

function initialState(): ThreadChatProjectState {
  return {
    entities: {
      project: null,
      threadsById: {},
      messagesById: {},
      messageIdsByThreadId: {},
      artifactsById: {},
      feedbackByMessageId: {},
    },
    runs: {
      byAssistantMessageId: {},
      streamBuffersByAssistantMessageId: {},
    },
    requests: {
      bootstrap: { status: "idle" },
      threadMessagesById: {},
      artifactById: {},
      commandByScope: {},
    },
    readModels: {
      artifactSummary: null,
      replacementSupersededMessageIds: {},
    },
    ui: {
      columnSlots: [],
      focusedSlotId: null,
      rootColumnWidthPx: null,
      forceColumnCount: null,
      placementMode: "replace",
      viewMode: "columns",
      canvasPins: {},
      composerDraftByThreadId: {},
      selectedArtifactId: null,
      activationClock: 0,
      lastActivatedOrderBySlotId: {},
      overlays: {
        selection: null,
        threadSwitcherScope: null,
        treeListOpen: false,
        helpPanelOpen: false,
        artifactDrawerOpen: false,
      },
    },
  }
}

function withMessages(
  state: ThreadChatProjectState,
  threadId: ThreadId,
  messages: readonly MessageEntity[],
  runs: readonly AssistantRunState[]
) {
  const normalized = normalizeMessages({
    threadId,
    currentById: state.entities.messagesById,
    currentIdsByThread: state.entities.messageIdsByThreadId,
    incoming: messages,
  })
  return {
    entities: {
      ...state.entities,
      ...normalized,
    },
    runs: {
      ...state.runs,
      byAssistantMessageId: normalizeRuns({
        current: state.runs.byAssistantMessageId,
        incoming: runs,
        messagesById: normalized.messagesById,
      }),
    },
  }
}

function isValidWidth(width: number | null): boolean {
  return (
    width === null || (Number.isFinite(width) && width >= 120 && width <= 2_000)
  )
}

function sanitizeSnapshot(
  snapshot: ThreadWorkbenchSnapshotV1,
  state: ThreadChatProjectState,
  projectId: string
): ThreadWorkbenchSnapshotV1 {
  clientInvariant(
    snapshot.schemaVersion === 1,
    "Unsupported workbench snapshot."
  )
  const seenSlots = new Set<string>()
  const seenThreads = new Set<string>()
  const columnSlots = snapshot.columnSlots.filter((slot) => {
    const thread = state.entities.threadsById[slot.threadId]
    const valid =
      slot.slotId.length > 0 &&
      !seenSlots.has(slot.slotId) &&
      !seenThreads.has(slot.threadId) &&
      thread?.projectId === projectId &&
      thread.parentThreadId !== null &&
      isValidWidth(slot.widthPx)
    if (valid) {
      seenSlots.add(slot.slotId)
      seenThreads.add(slot.threadId)
    }
    return valid
  })
  const expandedSlotIds = new Set(
    columnSlots.filter((slot) => !slot.folded).map((slot) => slot.slotId)
  )
  const focusedSlotId =
    snapshot.focusedSlotId === "root" ||
    expandedSlotIds.has(snapshot.focusedSlotId)
      ? snapshot.focusedSlotId
      : (columnSlots.find((slot) => !slot.folded)?.slotId ?? "root")
  const canvasPins = Object.fromEntries(
    Object.entries(snapshot.canvasPins).filter(
      ([threadId, point]) =>
        state.entities.threadsById[threadId]?.projectId === projectId &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
    )
  )
  return {
    ...snapshot,
    columnSlots,
    focusedSlotId,
    rootColumnWidthPx: isValidWidth(snapshot.rootColumnWidthPx)
      ? snapshot.rootColumnWidthPx
      : null,
    forceColumnCount:
      snapshot.forceColumnCount === null ||
      (Number.isInteger(snapshot.forceColumnCount) &&
        snapshot.forceColumnCount > 0 &&
        snapshot.forceColumnCount <= 12)
        ? snapshot.forceColumnCount
        : null,
    canvasPins,
  }
}

function findRootThreadId(state: ThreadChatProjectState): string | null {
  return (
    Object.values(state.entities.threadsById).find(
      (thread) => thread.parentThreadId === null
    )?.id ?? null
  )
}

function nextFocusedSlot(
  slots: readonly ThreadColumnSlot[],
  removedIndex: number
): "root" | string {
  for (let distance = 0; distance < slots.length; distance++) {
    const right = slots[removedIndex + distance]
    if (right && !right.folded) return right.slotId
    const left = slots[removedIndex - distance - 1]
    if (left && !left.folded) return left.slotId
  }
  return "root"
}

function checkpointFromEvent(event: AssistantMessageEvent) {
  if (event.type !== "run.delta") return null
  const chunk = event.chunk as {
    type?: string
    data?: { checkpointParts?: AssistantRunState["checkpointParts"] }
  }
  return chunk.type === "data-run-checkpoint" &&
    Array.isArray(chunk.data?.checkpointParts)
    ? chunk.data.checkpointParts
    : null
}

export function createThreadChatProjectStore(input: {
  projectId: string
  generateSlotId?: () => string
}) {
  const generateSlotId =
    input.generateSlotId ?? (() => globalThis.crypto.randomUUID())

  return createStore<ThreadChatProjectStore>()((set) => ({
    ...initialState(),
    mergeCreationBundle(bundle) {
      set((state) => {
        clientInvariant(
          bundle.project.id === input.projectId,
          "Creation Bundle belongs to another Project."
        )
        const threadsById = normalizeThreads({
          projectId: input.projectId,
          current: state.entities.threadsById,
          incoming: [bundle.rootThread],
        })
        const merged = withMessages(
          { ...state, entities: { ...state.entities, threadsById } },
          bundle.rootThread.id,
          [bundle.userMessage, bundle.assistantMessage],
          [bundle.assistantRun]
        )
        return {
          entities: {
            ...merged.entities,
            project: bundle.project,
          },
          runs: merged.runs,
          requests: {
            ...state.requests,
            bootstrap: { status: "ready" },
            threadMessagesById: {
              ...state.requests.threadMessagesById,
              [bundle.rootThread.id]: {
                loadState: { status: "ready" },
                hasOlderMessages: false,
                oldestReturnedSequence: bundle.userMessage.sequence,
                newestReturnedSequence: bundle.assistantMessage.sequence,
              },
            },
          },
          readModels: {
            ...state.readModels,
            artifactSummary: mergeArtifactSummary(
              state.readModels.artifactSummary,
              bundle.artifactSummary
            ),
          },
          ui: {
            ...state.ui,
            focusedSlotId: "root",
            activationClock: state.ui.activationClock + 1,
            lastActivatedOrderBySlotId: {
              ...state.ui.lastActivatedOrderBySlotId,
              root: state.ui.activationClock + 1,
            },
          },
        }
      })
    },
    mergeBootstrap(bootstrap) {
      set((state) => {
        clientInvariant(
          bootstrap.project.id === input.projectId,
          "Bootstrap belongs to another Project."
        )
        const threadsById = normalizeThreads({
          projectId: input.projectId,
          current: state.entities.threadsById,
          incoming: bootstrap.threadTopology,
        })
        const merged = withMessages(
          { ...state, entities: { ...state.entities, threadsById } },
          bootstrap.initialThread.threadId,
          bootstrap.initialThread.messages,
          bootstrap.initialThread.assistantRuns
        )
        return {
          entities: {
            ...merged.entities,
            project: bootstrap.project,
          },
          runs: merged.runs,
          requests: {
            ...state.requests,
            bootstrap: { status: "ready" },
            threadMessagesById: {
              ...state.requests.threadMessagesById,
              [bootstrap.initialThread.threadId]: {
                loadState: { status: "ready" },
                hasOlderMessages: bootstrap.initialThread.hasOlderMessages,
                oldestReturnedSequence:
                  bootstrap.initialThread.oldestReturnedSequence,
                newestReturnedSequence:
                  bootstrap.initialThread.newestReturnedSequence,
              },
            },
          },
          readModels: {
            ...state.readModels,
            artifactSummary: mergeArtifactSummary(
              state.readModels.artifactSummary,
              bootstrap.artifactSummary
            ),
          },
          ui: {
            ...state.ui,
            focusedSlotId: state.ui.focusedSlotId ?? "root",
          },
        }
      })
    },
    applyMessageBundle(bundle) {
      set((state) => {
        const thread = state.entities.threadsById[bundle.threadId]
        clientInvariant(
          thread?.projectId === input.projectId,
          "Message Bundle Thread belongs to another Project."
        )
        const merged = withMessages(
          state,
          bundle.threadId,
          bundle.messages,
          bundle.assistantRuns
        )
        return {
          entities: merged.entities,
          runs: merged.runs,
          requests: {
            ...state.requests,
            threadMessagesById: {
              ...state.requests.threadMessagesById,
              [bundle.threadId]: {
                loadState: { status: "ready" },
                hasOlderMessages: bundle.hasOlderMessages,
                oldestReturnedSequence: bundle.oldestReturnedSequence,
                newestReturnedSequence: bundle.newestReturnedSequence,
              },
            },
          },
        }
      })
    },
    applyMessageCreationBundle(bundle) {
      set((state) => {
        clientInvariant(
          bundle.userMessage.threadId === bundle.assistantMessage.threadId &&
            state.entities.threadsById[bundle.userMessage.threadId]
              ?.projectId === input.projectId,
          "Message Creation Bundle belongs to another Project."
        )
        return withMessages(
          state,
          bundle.userMessage.threadId,
          [bundle.userMessage, bundle.assistantMessage],
          [bundle.assistantRun]
        )
      })
    },
    applyThreadCreated(thread) {
      set((state) => ({
        entities: {
          ...state.entities,
          threadsById: normalizeThreads({
            projectId: input.projectId,
            current: state.entities.threadsById,
            incoming: [thread],
          }),
        },
      }))
    },
    applyReplacementBundle(bundle) {
      set((state) => {
        clientInvariant(
          bundle.createdMessages.length > 0,
          "Replacement Bundle contains no Message."
        )
        const threadId = bundle.createdMessages[0].threadId
        clientInvariant(
          bundle.createdMessages.every(
            (message) => message.threadId === threadId
          ) &&
            state.entities.threadsById[threadId]?.projectId ===
              input.projectId &&
            bundle.supersededMessageIds.every(
              (messageId) => state.entities.messagesById[messageId]
            ),
          "Replacement Bundle relations are invalid."
        )
        const merged = withMessages(state, threadId, bundle.createdMessages, [
          bundle.assistantRun,
        ])
        return {
          ...merged,
          readModels: {
            ...state.readModels,
            replacementSupersededMessageIds: {
              ...state.readModels.replacementSupersededMessageIds,
              ...Object.fromEntries(
                bundle.supersededMessageIds.map((messageId) => [
                  messageId,
                  true,
                ])
              ),
            },
          },
        }
      })
    },
    applyRunEvent(event, scopedAssistantMessageId) {
      set((state) => {
        if (event.type === "run.delta") {
          const assistantMessageId = scopedAssistantMessageId
          const run = assistantMessageId
            ? state.runs.byAssistantMessageId[assistantMessageId]
            : undefined
          clientInvariant(
            assistantMessageId && run,
            "Run delta cannot be associated with a loaded assistant Message."
          )
          if (event.eventSequence <= run.eventSequence) return state
          const currentBuffer = state.runs.streamBuffersByAssistantMessageId[
            assistantMessageId
          ] ?? {
            pendingChunks: [],
            lastReceivedEventSequence: run.eventSequence,
            flushScheduled: false,
          }
          if (event.eventSequence <= currentBuffer.lastReceivedEventSequence)
            return state
          clientInvariant(
            event.eventSequence === currentBuffer.lastReceivedEventSequence + 1,
            "Run delta eventSequence contains a gap."
          )
          return {
            runs: {
              byAssistantMessageId: {
                ...state.runs.byAssistantMessageId,
                [assistantMessageId]: {
                  ...run,
                  status: "running",
                  eventSequence: event.eventSequence,
                },
              },
              streamBuffersByAssistantMessageId: {
                ...state.runs.streamBuffersByAssistantMessageId,
                [assistantMessageId]: {
                  pendingChunks: [...currentBuffer.pendingChunks, event.chunk],
                  lastReceivedEventSequence: event.eventSequence,
                  flushScheduled: true,
                },
              },
            },
          }
        }

        const run = event.run
        const existing = state.runs.byAssistantMessageId[run.assistantMessageId]
        if (existing && run.eventSequence < existing.eventSequence) return state
        let entities = state.entities
        if (
          event.type === "run.snapshot" ||
          event.type === "run.completed" ||
          event.type === "run.stopped"
        ) {
          const normalized = normalizeMessages({
            threadId: event.message.threadId,
            currentById: entities.messagesById,
            currentIdsByThread: entities.messageIdsByThreadId,
            incoming: [event.message],
          })
          entities = { ...entities, ...normalized }
        }
        return {
          entities,
          runs: {
            byAssistantMessageId: normalizeRuns({
              current: state.runs.byAssistantMessageId,
              incoming: [run],
              messagesById: entities.messagesById,
            }),
            streamBuffersByAssistantMessageId: Object.fromEntries(
              Object.entries(
                state.runs.streamBuffersByAssistantMessageId
              ).filter(
                ([assistantMessageId]) =>
                  assistantMessageId !== run.assistantMessageId
              )
            ),
          },
          readModels:
            event.type === "run.snapshot" || event.type === "run.completed"
              ? {
                  ...state.readModels,
                  artifactSummary: mergeArtifactSummary(
                    state.readModels.artifactSummary,
                    event.artifactSummary
                  ),
                }
              : state.readModels,
        }
      })
    },
    applyAssistantRun(run) {
      set((state) => ({
        runs: {
          ...state.runs,
          byAssistantMessageId: normalizeRuns({
            current: state.runs.byAssistantMessageId,
            incoming: [run],
            messagesById: state.entities.messagesById,
          }),
        },
      }))
    },
    flushRunBuffer(assistantMessageId) {
      set((state) => {
        const buffer =
          state.runs.streamBuffersByAssistantMessageId[assistantMessageId]
        const run = state.runs.byAssistantMessageId[assistantMessageId]
        if (!buffer || !run) return state
        let checkpointParts = run.checkpointParts
        for (const chunk of buffer.pendingChunks) {
          const candidate = checkpointFromEvent({
            type: "run.delta",
            eventSequence: buffer.lastReceivedEventSequence,
            chunk,
          })
          if (candidate) checkpointParts = candidate
        }
        return {
          runs: {
            byAssistantMessageId: {
              ...state.runs.byAssistantMessageId,
              [assistantMessageId]: { ...run, checkpointParts },
            },
            streamBuffersByAssistantMessageId: {
              ...state.runs.streamBuffersByAssistantMessageId,
              [assistantMessageId]: {
                ...buffer,
                pendingChunks: [],
                flushScheduled: false,
              },
            },
          },
        }
      })
    },
    applyArtifact(artifact) {
      set((state) => {
        clientInvariant(
          artifact.projectId === input.projectId,
          "Artifact belongs to another Project."
        )
        return {
          entities: {
            ...state.entities,
            artifactsById: {
              ...state.entities.artifactsById,
              [artifact.id]: artifact,
            },
          },
          requests: {
            ...state.requests,
            artifactById: {
              ...state.requests.artifactById,
              [artifact.id]: { status: "ready" },
            },
          },
        }
      })
    },
    applyProject(project) {
      clientInvariant(
        project.id === input.projectId,
        "Project response belongs to another Runtime."
      )
      set((state) => ({ entities: { ...state.entities, project } }))
    },
    applyThread(thread) {
      set((state) => ({
        entities: {
          ...state.entities,
          threadsById: {
            ...state.entities.threadsById,
            ...normalizeThreads({
              projectId: input.projectId,
              current: state.entities.threadsById,
              incoming: [thread],
            }),
          },
        },
      }))
    },
    applyFeedback(feedback) {
      set((state) => {
        clientInvariant(
          state.entities.messagesById[feedback.messageId]?.role === "assistant",
          "Feedback response does not reference a loaded assistant Message."
        )
        return {
          entities: {
            ...state.entities,
            feedbackByMessageId: {
              ...state.entities.feedbackByMessageId,
              [feedback.messageId]: feedback,
            },
          },
        }
      })
    },
    setBootstrapLoadState(bootstrap) {
      set((state) => ({ requests: { ...state.requests, bootstrap } }))
    },
    setCommandState(scope, commandState) {
      set((state) => {
        const commandByScope = { ...state.requests.commandByScope }
        if (commandState) commandByScope[scope] = commandState
        else delete commandByScope[scope]
        return {
          requests: { ...state.requests, commandByScope },
        }
      })
    },
    setThreadMessageLoadState(threadId, loadState) {
      set((state) => ({
        requests: {
          ...state.requests,
          threadMessagesById: {
            ...state.requests.threadMessagesById,
            [threadId]: {
              ...(state.requests.threadMessagesById[threadId] ?? {
                hasOlderMessages: false,
                oldestReturnedSequence: null,
                newestReturnedSequence: null,
              }),
              loadState,
            },
          },
        },
      }))
    },
    setArtifactLoadState(artifactId, loadState) {
      set((state) => ({
        requests: {
          ...state.requests,
          artifactById: {
            ...state.requests.artifactById,
            [artifactId]: loadState,
          },
        },
      }))
    },
    restoreWorkbenchSnapshot(snapshot) {
      set((state) => {
        clientInvariant(
          state.requests.bootstrap.status === "ready",
          "Workbench can only be restored after Bootstrap."
        )
        const sanitized = sanitizeSnapshot(snapshot, state, input.projectId)
        return {
          ui: {
            ...state.ui,
            columnSlots: sanitized.columnSlots,
            focusedSlotId: sanitized.focusedSlotId,
            rootColumnWidthPx: sanitized.rootColumnWidthPx,
            forceColumnCount: sanitized.forceColumnCount,
            placementMode: sanitized.placementMode,
            viewMode: sanitized.viewMode,
            canvasPins: sanitized.canvasPins,
          },
        }
      })
    },
    resetWorkbenchToDefault() {
      set((state) => ({
        ui: {
          ...state.ui,
          columnSlots: [],
          focusedSlotId: findRootThreadId(state) ? "root" : null,
          rootColumnWidthPx: null,
          forceColumnCount: null,
          placementMode: "replace",
          viewMode: "columns",
          canvasPins: {},
        },
      }))
    },
    openThread(threadId, sourceSlotId, placement) {
      set((state) => {
        const thread = state.entities.threadsById[threadId]
        clientInvariant(
          thread?.projectId === input.projectId &&
            thread.parentThreadId !== null,
          "Only a Branch in this Project can open in a column."
        )
        const existingIndex = state.ui.columnSlots.findIndex(
          (slot) => slot.threadId === threadId
        )
        const maxExpanded = Math.max(
          0,
          placement?.maxExpanded ??
            (state.ui.forceColumnCount === null
              ? Number.POSITIVE_INFINITY
              : state.ui.forceColumnCount - 1)
        )
        const clock = state.ui.activationClock + 1
        if (existingIndex >= 0) {
          let slots = state.ui.columnSlots.map((slot, index) =>
            index === existingIndex ? { ...slot, folded: false } : slot
          )
          const slotId = slots[existingIndex].slotId
          if (
            state.ui.placementMode === "fold" &&
            slots.filter((slot) => !slot.folded).length > maxExpanded
          ) {
            const candidates = slots
              .filter(
                (slot) =>
                  !slot.folded &&
                  slot.slotId !== slotId &&
                  slot.slotId !== sourceSlotId
              )
              .toSorted(
                (left, right) =>
                  (state.ui.lastActivatedOrderBySlotId[left.slotId] ?? 0) -
                  (state.ui.lastActivatedOrderBySlotId[right.slotId] ?? 0)
              )
            const fallback = slots.find(
              (slot) => !slot.folded && slot.slotId !== slotId
            )
            const foldTarget = candidates[0] ?? fallback
            if (foldTarget)
              slots = slots.map((slot) =>
                slot.slotId === foldTarget.slotId
                  ? { ...slot, folded: true }
                  : slot
              )
          }
          return {
            ui: {
              ...state.ui,
              columnSlots: slots,
              focusedSlotId: slotId,
              activationClock: clock,
              lastActivatedOrderBySlotId: {
                ...state.ui.lastActivatedOrderBySlotId,
                [slotId]: clock,
              },
            },
          }
        }

        let slots = [...state.ui.columnSlots]
        const sourceIndex =
          sourceSlotId === "root"
            ? -1
            : slots.findIndex((slot) => slot.slotId === sourceSlotId)
        const expandedSlots = () => slots.filter((slot) => !slot.folded)
        const lru = (pool: readonly ThreadColumnSlot[]) =>
          pool.toSorted(
            (left, right) =>
              (state.ui.lastActivatedOrderBySlotId[left.slotId] ?? 0) -
              (state.ui.lastActivatedOrderBySlotId[right.slotId] ?? 0)
          )[0]
        const finish = (slotId: string) => ({
          ui: {
            ...state.ui,
            columnSlots: slots,
            focusedSlotId: slotId,
            activationClock: clock,
            lastActivatedOrderBySlotId: {
              ...state.ui.lastActivatedOrderBySlotId,
              [slotId]: clock,
            },
          },
        })
        const replaceSlot = (slotId: string) => {
          slots = slots.map((slot) =>
            slot.slotId === slotId
              ? { ...slot, threadId, folded: false }
              : slot
          )
          return finish(slotId)
        }

        const target = placement?.targetSlotId
          ? slots.find((slot) => slot.slotId === placement.targetSlotId)
          : undefined
        if (target && state.ui.placementMode === "replace")
          return replaceSlot(target.slotId)

        if (
          state.ui.placementMode === "replace" &&
          expandedSlots().length >= maxExpanded
        ) {
          let candidate = target
          if (!candidate && placement?.keepSource) {
            candidate = slots[sourceIndex + 1]
            if (!candidate)
              candidate = lru(
                expandedSlots().filter(
                  (slot) => slot.slotId !== sourceSlotId
                )
              )
          }
          if (!candidate && sourceSlotId !== "root")
            candidate = slots.find((slot) => slot.slotId === sourceSlotId)
          candidate ??= lru(expandedSlots())
          if (candidate) return replaceSlot(candidate.slotId)
        }

        const slotId = generateSlotId()
        const insertAt = placement?.keepSource ? sourceIndex + 1 : slots.length
        slots.splice(insertAt, 0, {
          slotId,
          threadId,
          folded: false,
          widthPx: null,
        })

        if (state.ui.placementMode === "fold") {
          let foldTarget = target
          if (!foldTarget && expandedSlots().length > maxExpanded) {
            const preferred = expandedSlots().filter(
              (slot) =>
                slot.slotId !== slotId && slot.slotId !== sourceSlotId
            )
            foldTarget = lru(
              preferred.length
                ? preferred
                : expandedSlots().filter((slot) => slot.slotId !== slotId)
            )
          }
          if (foldTarget && foldTarget.slotId !== slotId)
            slots = slots.map((slot) =>
              slot.slotId === foldTarget.slotId
                ? { ...slot, folded: true }
                : slot
            )
        }
        return {
          ui: {
            ...state.ui,
            columnSlots: slots,
            focusedSlotId: slotId,
            activationClock: clock,
            lastActivatedOrderBySlotId: {
              ...state.ui.lastActivatedOrderBySlotId,
              [slotId]: clock,
            },
          },
        }
      })
    },
    switchColumnThread(slotId, threadId) {
      set((state) => {
        const thread = state.entities.threadsById[threadId]
        clientInvariant(
          thread?.projectId === input.projectId &&
            thread.parentThreadId !== null,
          "Column target must be a Branch in this Project."
        )
        const source = state.ui.columnSlots.find(
          (slot) => slot.slotId === slotId
        )
        clientInvariant(source, "Column Slot does not exist.")
        const duplicate = state.ui.columnSlots.find(
          (slot) => slot.slotId !== slotId && slot.threadId === threadId
        )
        const clock = state.ui.activationClock + 1
        return {
          ui: {
            ...state.ui,
            columnSlots: state.ui.columnSlots.map((slot) => {
              if (slot.slotId === slotId)
                return { ...slot, threadId, folded: false }
              if (duplicate?.slotId === slot.slotId)
                return { ...slot, threadId: source.threadId }
              return slot
            }),
            focusedSlotId: slotId,
            activationClock: clock,
            lastActivatedOrderBySlotId: {
              ...state.ui.lastActivatedOrderBySlotId,
              [slotId]: clock,
            },
          },
        }
      })
    },
    closeColumn(slotId) {
      set((state) => {
        const index = state.ui.columnSlots.findIndex(
          (slot) => slot.slotId === slotId
        )
        if (index < 0) return state
        const columnSlots = state.ui.columnSlots.filter(
          (slot) => slot.slotId !== slotId
        )
        const focusedSlotId =
          state.ui.focusedSlotId === slotId
            ? nextFocusedSlot(columnSlots, index)
            : state.ui.focusedSlotId
        const lastActivatedOrderBySlotId = {
          ...state.ui.lastActivatedOrderBySlotId,
        }
        delete lastActivatedOrderBySlotId[slotId]
        return {
          ui: {
            ...state.ui,
            columnSlots,
            focusedSlotId,
            lastActivatedOrderBySlotId,
          },
        }
      })
    },
    setColumnFolded(slotId, folded) {
      set((state) => {
        const index = state.ui.columnSlots.findIndex(
          (slot) => slot.slotId === slotId
        )
        if (index < 0) return state
        const columnSlots = state.ui.columnSlots.map((slot) =>
          slot.slotId === slotId ? { ...slot, folded } : slot
        )
        return {
          ui: {
            ...state.ui,
            columnSlots,
            focusedSlotId:
              folded && state.ui.focusedSlotId === slotId
                ? nextFocusedSlot(columnSlots, index)
                : folded
                  ? state.ui.focusedSlotId
                  : slotId,
          },
        }
      })
    },
    focusColumn(slotId) {
      set((state) => {
        clientInvariant(
          slotId === "root" ||
            state.ui.columnSlots.some(
              (slot) => slot.slotId === slotId && !slot.folded
            ),
          "Focused column must exist and be expanded."
        )
        const clock = state.ui.activationClock + 1
        return {
          ui: {
            ...state.ui,
            focusedSlotId: slotId,
            activationClock: clock,
            lastActivatedOrderBySlotId: {
              ...state.ui.lastActivatedOrderBySlotId,
              [slotId]: clock,
            },
          },
        }
      })
    },
    commitColumnWidths(widths) {
      set((state) => {
        for (const width of Object.values(widths))
          clientInvariant(
            width === undefined || isValidWidth(width),
            "Column width is invalid."
          )
        return {
          ui: {
            ...state.ui,
            rootColumnWidthPx:
              widths.root === undefined
                ? state.ui.rootColumnWidthPx
                : widths.root,
            columnSlots: state.ui.columnSlots.map((slot) => {
              const width = widths[slot.slotId]
              return {
                ...slot,
                widthPx: width === undefined ? slot.widthPx : width,
              }
            }),
          },
        }
      })
    },
    setForceColumnCount(forceColumnCount) {
      clientInvariant(
        forceColumnCount === null ||
          (Number.isInteger(forceColumnCount) && forceColumnCount > 0),
        "Forced column count is invalid."
      )
      set((state) => ({ ui: { ...state.ui, forceColumnCount } }))
    },
    setPlacementMode(placementMode) {
      set((state) => ({ ui: { ...state.ui, placementMode } }))
    },
    setViewMode(viewMode) {
      set((state) => ({ ui: { ...state.ui, viewMode } }))
    },
    setCanvasPin(threadId, point) {
      set((state) => {
        clientInvariant(
          state.entities.threadsById[threadId]?.projectId === input.projectId,
          "Canvas pin Thread belongs to another Project."
        )
        const canvasPins = { ...state.ui.canvasPins }
        if (point) canvasPins[threadId] = point
        else delete canvasPins[threadId]
        return { ui: { ...state.ui, canvasPins } }
      })
    },
    setComposerDraft(threadId, parts) {
      set((state) => {
        clientInvariant(
          state.entities.threadsById[threadId]?.projectId === input.projectId,
          "Composer draft Thread belongs to another Project."
        )
        return {
          ui: {
            ...state.ui,
            composerDraftByThreadId: {
              ...state.ui.composerDraftByThreadId,
              [threadId]: parts,
            },
          },
        }
      })
    },
    setSelectedArtifact(selectedArtifactId) {
      set((state) => ({ ui: { ...state.ui, selectedArtifactId } }))
    },
    setOverlays(patch) {
      set((state) => ({
        ui: {
          ...state.ui,
          overlays: { ...state.ui.overlays, ...patch },
        },
      }))
    },
  }))
}
