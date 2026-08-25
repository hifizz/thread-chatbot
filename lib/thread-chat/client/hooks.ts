"use client"

import { useCallback, useEffect, useMemo } from "react"
import { useStore } from "zustand"
import { submitNewProjectDraft } from "./commands"
import {
  selectAppShellUi,
  selectArtifact,
  selectAssistantRun,
  selectFocusedColumnId,
  selectFocusedThreadId,
  selectForkAvailability,
  selectProject,
  selectProjectCatalog,
  selectProjectHeaderView,
  selectProjectTarget,
  selectProjectTreeRows,
  selectThread,
  selectThreadColumnHeaderView,
  selectThreadColumnView,
  selectThreadMessages,
  selectVisibleThreadColumns,
} from "./selectors"
import {
  useNewProjectDraftStoreApi,
  useThreadChatAppRuntime,
  useThreadChatProjectRuntime,
} from "./providers"
import type {
  NewProjectDraftStore,
  ThreadChatAppStore,
  ThreadChatProjectStore,
} from "./types"

export function useThreadChatAppStore<T>(
  selector: (state: ThreadChatAppStore) => T
): T {
  return useStore(useThreadChatAppRuntime().appStore, selector)
}

export function useThreadChatStore<T>(
  selector: (state: ThreadChatProjectStore) => T
): T {
  return useStore(useThreadChatProjectRuntime().store, selector)
}

export function useNewProjectDraftStore<T>(
  selector: (state: NewProjectDraftStore) => T
): T {
  return useStore(useNewProjectDraftStoreApi(), selector)
}

export const useProjectCatalog = () =>
  useThreadChatAppStore(selectProjectCatalog)
export const useAppShellUi = () => useThreadChatAppStore(selectAppShellUi)
export const useProject = () => useThreadChatStore(selectProject)
export const useProjectTarget = () => useThreadChatStore(selectProjectTarget)
export const useThread = (threadId: string) =>
  useThreadChatStore((state) => selectThread(state, threadId))
export const useThreadMessages = (threadId: string) =>
  useThreadChatStore((state) => selectThreadMessages(state, threadId))
export const useThreadColumnView = (slotId: "root" | string) =>
  useThreadChatStore((state) => selectThreadColumnView(state, slotId))
export const useThreadColumnHeaderView = (slotId: "root" | string) =>
  useThreadChatStore((state) => selectThreadColumnHeaderView(state, slotId))
export const useProjectTreeRows = () =>
  useThreadChatStore(selectProjectTreeRows)
export const useAssistantRun = (assistantMessageId: string) =>
  useThreadChatStore((state) => selectAssistantRun(state, assistantMessageId))
export const useArtifact = (artifactId: string) =>
  useThreadChatStore((state) => selectArtifact(state, artifactId))
export const useForkAvailability = (messageId: string) =>
  useThreadChatStore((state) => selectForkAvailability(state, messageId))
export const useVisibleThreadColumns = () =>
  useThreadChatStore(selectVisibleThreadColumns)
export const useProjectHeaderView = () =>
  useThreadChatStore(selectProjectHeaderView)
export const useFocusedColumnId = () =>
  useThreadChatStore(selectFocusedColumnId)
export const useFocusedThreadId = () =>
  useThreadChatStore(selectFocusedThreadId)

export function useAppShellCommands() {
  const runtime = useThreadChatAppRuntime()
  return useMemo(
    () => ({
      setSidebarOpen: runtime.appStore.getState().setSidebarOpen,
      setSidebarWidth: runtime.appStore.getState().setSidebarWidth,
      setProjectSearchQuery: runtime.appStore.getState().setProjectSearchQuery,
      setCatalogFilter: runtime.appStore.getState().setCatalogFilter,
      setProjectRoutePending:
        runtime.appStore.getState().setProjectRoutePending,
      loadProjectCatalog: runtime.commands.loadProjectCatalog,
    }),
    [runtime]
  )
}

export function useProjectCommands() {
  const runtime = useThreadChatProjectRuntime()
  return runtime.commands
}

export function useThreadCommands(threadId: string) {
  const runtime = useThreadChatProjectRuntime()
  return useMemo(
    () => ({
      send: runtime.commands.sendMessage.bind(null, threadId),
      updateTitle: runtime.commands.updateThread.bind(null, threadId),
      setArchived: runtime.commands.setThreadArchived.bind(null, threadId),
      ensureLoaded: runtime.commands.ensureThreadMessages.bind(null, threadId),
      fork: (
        sourceSlotId: "root" | string,
        sourceMessageId: string,
        anchor?: {
          exactQuote: string
          textPosition?: { start: number; end: number }
        }
      ) =>
        runtime.commands.forkThread({
          sourceSlotId,
          sourceThreadId: threadId,
          sourceMessageId,
          anchor,
        }),
    }),
    [runtime, threadId]
  )
}

export function useMessageCommands(messageId: string) {
  const runtime = useThreadChatProjectRuntime()
  return useMemo(
    () => ({
      edit: runtime.commands.editMessage.bind(null, messageId),
      regenerate: runtime.commands.regenerateMessage.bind(null, messageId),
      feedback: runtime.commands.setFeedback.bind(null, messageId),
      stop: () => runtime.commands.stopAssistant(messageId),
    }),
    [messageId, runtime]
  )
}

export function useSubmitNewProjectDraft() {
  const appRuntime = useThreadChatAppRuntime()
  const draftStore = useNewProjectDraftStoreApi()
  return useCallback(
    () =>
      submitNewProjectDraft({
        api: appRuntime.api,
        appStore: appRuntime.appStore,
        registry: appRuntime.projectRuntimeRegistry,
        navigation: appRuntime.navigation,
        draftStore,
      }),
    [appRuntime, draftStore]
  )
}

export function useEnsureThreadMessagesLoaded(threadId: string | null) {
  const runtime = useThreadChatProjectRuntime()
  useEffect(() => {
    if (threadId) void runtime.commands.ensureThreadMessages(threadId)
  }, [runtime, threadId])
}

export function useEnsureArtifactLoaded(
  artifactId: string | null,
  enabled = true
) {
  const runtime = useThreadChatProjectRuntime()
  useEffect(() => {
    if (enabled && artifactId) void runtime.commands.ensureArtifact(artifactId)
  }, [artifactId, enabled, runtime])
}

export function useActiveGenerationSubscriptions() {
  const runtime = useThreadChatProjectRuntime()
  useEffect(() => {
    runtime.generationCoordinator.resumeLoadedRuns()
  }, [runtime])
}
