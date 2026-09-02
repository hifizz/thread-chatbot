import { createStore, type StoreApi } from "zustand/vanilla"

import type {
  ArtifactDTO,
  MessageDTO,
  ProjectBootstrapDTO,
  ProjectDTO,
  ProjectFileDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type {
  ConversationEntitySnapshot,
  ConversationStreamState,
  NormalizedThreadChatState,
  WorkspaceUiState,
} from "./types"

export type ConversationStore = StoreApi<NormalizedThreadChatState>

const EMPTY_WORKSPACE: WorkspaceUiState = {
  view: "columns",
  openThreadIds: [],
  columnSlots: [],
  columnWidths: {},
  forceColumns: null,
  placementMode: "replace",
  selectedThreadId: "",
  recents: [],
  canvas: { pins: {} },
  panelSizes: {},
  expandedNodes: [],
}

function orderedMessageIds(messages: MessageDTO[]): Record<string, string[]> {
  const byThread: Record<string, MessageDTO[]> = {}
  for (const message of messages) {
    ;(byThread[message.threadId] ??= []).push(message)
  }
  return Object.fromEntries(
    Object.entries(byThread).map(([threadId, rows]) => [
      threadId,
      rows
        .sort((left, right) => left.sequence - right.sequence)
        .map((row) => row.id),
    ])
  )
}

function streamState(
  phase: ConversationStreamState["phase"]
): ConversationStreamState {
  return { phase, lastEventSeq: 0, pollAttempt: 0 }
}

function entitiesFromBootstrap(
  bootstrap: ProjectBootstrapDTO
): ConversationEntitySnapshot {
  const active = new Set(bootstrap.activeGenerationIds)
  return {
    project: bootstrap.project,
    projectFilesById: Object.fromEntries(
      bootstrap.files.map((file) => [file.attachmentId, file])
    ),
    projectFileOrder: bootstrap.files.map((file) => file.attachmentId),
    threadsById: Object.fromEntries(
      bootstrap.threads.map((thread) => [thread.id, thread])
    ),
    messagesById: Object.fromEntries(
      bootstrap.messages.map((message) => [message.id, message])
    ),
    messageIdsByThread: orderedMessageIds(bootstrap.messages),
    artifactsById: Object.fromEntries(
      bootstrap.artifacts.map((artifact) => [artifact.id, artifact])
    ),
    artifactOrder: bootstrap.artifacts.map((artifact) => artifact.id),
    streamByMessageId: Object.fromEntries(
      bootstrap.messages
        .filter((message) => active.has(message.id))
        .map((message) => [message.id, streamState("background")])
    ),
  }
}

function emptyEntities(): ConversationEntitySnapshot {
  return entitiesFromBootstrap({
    project: null,
    files: [],
    threads: [],
    messages: [],
    artifacts: [],
    activeGenerationIds: [],
  })
}

function entitySnapshot(
  state: NormalizedThreadChatState
): ConversationEntitySnapshot {
  return structuredClone({
    project: state.project,
    projectFilesById: state.projectFilesById,
    projectFileOrder: state.projectFileOrder,
    threadsById: state.threadsById,
    messagesById: state.messagesById,
    messageIdsByThread: state.messageIdsByThread,
    artifactsById: state.artifactsById,
    artifactOrder: state.artifactOrder,
    streamByMessageId: state.streamByMessageId,
  })
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function rollbackRecord<T>(
  current: Record<string, T>,
  before: Record<string, T>,
  after: Record<string, T>
): Record<string, T> {
  const result = { ...current }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (sameValue(before[key], after[key])) continue
    if (!sameValue(current[key], after[key])) continue
    if (before[key] === undefined) delete result[key]
    else result[key] = structuredClone(before[key])
  }
  return result
}

function insertMessageId(
  current: string[] | undefined,
  message: MessageDTO,
  messagesById: Record<string, MessageDTO>
): string[] {
  const ids = current?.includes(message.id)
    ? [...current]
    : [...(current ?? []), message.id]
  return ids.sort(
    (left, right) =>
      (left === message.id ? message : messagesById[left])!.sequence -
      (right === message.id ? message : messagesById[right])!.sequence
  )
}

export function createConversationStore(input?: {
  bootstrap?: ProjectBootstrapDTO
  workspace?: Partial<WorkspaceUiState>
}): ConversationStore {
  const initial = input?.bootstrap
    ? entitiesFromBootstrap(input.bootstrap)
    : emptyEntities()
  return createStore<NormalizedThreadChatState>()((set, get) => ({
    ...initial,
    optimisticByCommandId: {},
    workspace: {
      ...structuredClone(EMPTY_WORKSPACE),
      ...input?.workspace,
    },
    hydrateProject(bootstrap) {
      set({
        ...entitiesFromBootstrap(bootstrap),
        optimisticByCommandId: {},
      })
    },
    upsertProject(project: ProjectDTO) {
      set({ project })
    },
    upsertProjectFile(file: ProjectFileDTO) {
      set((state) => ({
        projectFilesById: {
          ...state.projectFilesById,
          [file.attachmentId]: file,
        },
        projectFileOrder: state.projectFileOrder.includes(file.attachmentId)
          ? state.projectFileOrder
          : [file.attachmentId, ...state.projectFileOrder],
      }))
    },
    removeProjectFile(attachmentId: string) {
      set((state) => {
        if (!state.projectFilesById[attachmentId]) return state
        const projectFilesById = { ...state.projectFilesById }
        delete projectFilesById[attachmentId]
        return {
          projectFilesById,
          projectFileOrder: state.projectFileOrder.filter(
            (id) => id !== attachmentId
          ),
        }
      })
    },
    upsertThread(thread: ThreadDTO) {
      set((state) => ({
        threadsById: { ...state.threadsById, [thread.id]: thread },
      }))
    },
    upsertMessage(message: MessageDTO) {
      set((state) => {
        const messagesById = { ...state.messagesById, [message.id]: message }
        return {
          messagesById,
          messageIdsByThread: {
            ...state.messageIdsByThread,
            [message.threadId]: insertMessageId(
              state.messageIdsByThread[message.threadId],
              message,
              messagesById
            ),
          },
        }
      })
    },
    upsertArtifact(artifact: ArtifactDTO) {
      set((state) => ({
        artifactsById: { ...state.artifactsById, [artifact.id]: artifact },
        artifactOrder: state.artifactOrder.includes(artifact.id)
          ? state.artifactOrder
          : [artifact.id, ...state.artifactOrder],
      }))
    },
    applyStreamSnapshot(messageId, message, throughSeq) {
      set((state) => {
        const current = state.streamByMessageId[messageId]
        if (current && throughSeq < current.lastEventSeq) return state
        return {
          streamByMessageId: {
            ...state.streamByMessageId,
            [messageId]: {
              phase: "live",
              liveMessage: structuredClone(message),
              lastEventSeq: throughSeq,
              pollAttempt: 0,
            },
          },
        }
      })
    },
    applyStreamChunk(messageId, message, seq) {
      set((state) => {
        const current = state.streamByMessageId[messageId]
        if (current && seq <= current.lastEventSeq) return state
        return {
          streamByMessageId: {
            ...state.streamByMessageId,
            [messageId]: {
              phase: "live",
              liveMessage: structuredClone(message),
              lastEventSeq: seq,
              pollAttempt: 0,
            },
          },
        }
      })
    },
    markConnectingGeneration(messageId) {
      set((state) => {
        const current =
          state.streamByMessageId[messageId] ?? streamState("connecting")
        return {
          streamByMessageId: {
            ...state.streamByMessageId,
            [messageId]: { ...current, phase: "connecting" },
          },
        }
      })
    },
    markBackgroundGeneration(messageId) {
      set((state) => {
        const current =
          state.streamByMessageId[messageId] ?? streamState("background")
        return {
          streamByMessageId: {
            ...state.streamByMessageId,
            [messageId]: { ...current, phase: "background" },
          },
        }
      })
    },
    mergePolledMessage(message) {
      if (message.status !== "generating") {
        get().reconcileTerminalMessage(message)
        return
      }
      set((state) => {
        const existing = state.messagesById[message.id]
        if (
          existing &&
          Date.parse(existing.updatedAt) > Date.parse(message.updatedAt)
        )
          return state
        const messagesById = { ...state.messagesById, [message.id]: message }
        const stream = state.streamByMessageId[message.id]
        return {
          messagesById,
          messageIdsByThread: {
            ...state.messageIdsByThread,
            [message.threadId]: insertMessageId(
              state.messageIdsByThread[message.threadId],
              message,
              messagesById
            ),
          },
          streamByMessageId: {
            ...state.streamByMessageId,
            [message.id]: {
              ...(stream ?? streamState("background")),
              phase: "background",
              pollAttempt: (stream?.pollAttempt ?? 0) + 1,
            },
          },
        }
      })
    },
    reconcileTerminalMessage(message) {
      set((state) => {
        const messagesById = { ...state.messagesById, [message.id]: message }
        return {
          messagesById,
          messageIdsByThread: {
            ...state.messageIdsByThread,
            [message.threadId]: insertMessageId(
              state.messageIdsByThread[message.threadId],
              message,
              messagesById
            ),
          },
          streamByMessageId: {
            ...state.streamByMessageId,
            [message.id]: {
              phase: "terminal",
              lastEventSeq:
                state.streamByMessageId[message.id]?.lastEventSeq ?? 0,
              pollAttempt: 0,
            },
          },
        }
      })
    },
    beginOptimisticCommand(commandId, apply) {
      set((state) => {
        if (state.optimisticByCommandId[commandId]) return state
        const before = entitySnapshot(state)
        const partial = apply(before)
        const after = { ...before, ...structuredClone(partial) }
        return {
          ...partial,
          optimisticByCommandId: {
            ...state.optimisticByCommandId,
            [commandId]: { commandId, before, after },
          },
        }
      })
    },
    commitOptimisticCommand(commandId) {
      set((state) => {
        if (!state.optimisticByCommandId[commandId]) return state
        const optimisticByCommandId = { ...state.optimisticByCommandId }
        delete optimisticByCommandId[commandId]
        return { optimisticByCommandId }
      })
    },
    rollbackOptimisticCommand(commandId) {
      set((state) => {
        const patch = state.optimisticByCommandId[commandId]
        if (!patch) return state
        const optimisticByCommandId = { ...state.optimisticByCommandId }
        delete optimisticByCommandId[commandId]
        const current = entitySnapshot(state)
        return {
          project:
            !sameValue(patch.before.project, patch.after.project) &&
            sameValue(current.project, patch.after.project)
              ? structuredClone(patch.before.project)
              : current.project,
          projectFilesById: rollbackRecord(
            current.projectFilesById,
            patch.before.projectFilesById,
            patch.after.projectFilesById
          ),
          projectFileOrder:
            !sameValue(
              patch.before.projectFileOrder,
              patch.after.projectFileOrder
            ) &&
            sameValue(current.projectFileOrder, patch.after.projectFileOrder)
              ? structuredClone(patch.before.projectFileOrder)
              : current.projectFileOrder,
          threadsById: rollbackRecord(
            current.threadsById,
            patch.before.threadsById,
            patch.after.threadsById
          ),
          messagesById: rollbackRecord(
            current.messagesById,
            patch.before.messagesById,
            patch.after.messagesById
          ),
          messageIdsByThread: rollbackRecord(
            current.messageIdsByThread,
            patch.before.messageIdsByThread,
            patch.after.messageIdsByThread
          ),
          artifactsById: rollbackRecord(
            current.artifactsById,
            patch.before.artifactsById,
            patch.after.artifactsById
          ),
          artifactOrder:
            !sameValue(patch.before.artifactOrder, patch.after.artifactOrder) &&
            sameValue(current.artifactOrder, patch.after.artifactOrder)
              ? structuredClone(patch.before.artifactOrder)
              : current.artifactOrder,
          streamByMessageId: rollbackRecord(
            current.streamByMessageId,
            patch.before.streamByMessageId,
            patch.after.streamByMessageId
          ),
          optimisticByCommandId,
        }
      })
    },
    removeProject(projectId) {
      set((state) =>
        state.project?.id === projectId
          ? { ...emptyEntities(), optimisticByCommandId: {} }
          : state
      )
    },
    setWorkspace(next) {
      set((state) => ({ workspace: { ...state.workspace, ...next } }))
    },
  }))
}
