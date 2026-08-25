"use client"

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/model"
import {
  selectThreadColumnHeaderView,
  selectThreadColumnView,
} from "@/lib/thread-chat/client/selectors"
import {
  useThreadChatProjectRuntime,
} from "@/lib/thread-chat/client/providers"
import { useThreadChatStore } from "@/lib/thread-chat/client/hooks"
import type { ThreadChatProjectStore } from "@/lib/thread-chat/client/types"
import type { ThreadStore } from "../core/store"
import type { MessageActionViewState } from "../chat/actions/message-action-types"
import type { ThreadMessageActionCommands } from "../chat/actions/message-action-commands"
import type { SelectionInfo } from "../branching/selection/selection-bubble"
import type { PlacementHint, Slot } from "../orchestration/columns/placement"
import type { SwitcherMode } from "../orchestration/navigation/thread-switcher"
import { useColumnViewport } from "../orchestration/columns/use-column-viewport"
import { ThreadColumns } from "../orchestration/columns/thread-columns"
import { ThreadChatTopbar } from "../orchestration/navigation/thread-chat-topbar"
import { ThreadSwitcher } from "../orchestration/navigation/thread-switcher"
import { useWorkspaceOverlays } from "../orchestration/overlays/use-workspace-overlays"
import { HelpPanel, UsageHint } from "../orchestration/overlays/help-panel"
import {
  useWorkspaceToast,
  WorkspaceToast,
} from "../orchestration/overlays/workspace-toast"
import { BranchableChat } from "../branching/branchable-chat"
import { SelectionBubble } from "../branching/selection/selection-bubble"
import { ArtifactDrawer } from "../orchestration/artifacts/artifact-drawer"
import { ProjectList } from "./project-list"
import { projectLegacyTreeView } from "./project-view-model"
import { useProjectWorkbench } from "./use-project-workbench"
import { kickoffQuestion } from "@/lib/thread-chat/application/prompt-policy"

const ThreadCanvas = dynamic(
  () =>
    import("../orchestration/canvas/thread-canvas").then(
      (module) => module.ThreadCanvas
    ),
  {
    ssr: false,
    loading: () => <div className="canvas-loading">画布加载中…</div>,
  }
)

const EMPTY_SLOTS: Slot[] = []

function useProjectedThreadStore(
  state: ThreadChatProjectStore,
  projected: ReturnType<typeof projectLegacyTreeView>,
  onModelChange: (modelId: string) => void
): ThreadStore {
  const rootThreadId = Object.values(state.entities.threadsById).find(
    (thread) => thread.parentThreadId === null
  )?.id
  return useMemo(
    () =>
      ({
        getState: () => projected,
        getVersion: () => 0,
        subscribe: () => () => undefined,
        setThreadModel: (threadId: string, modelId: string) => {
          if (rootThreadId === threadId) onModelChange(modelId)
        },
      }) as unknown as ThreadStore,
    [onModelChange, projected, rootThreadId]
  )
}

function messageActionView(
  state: ThreadChatProjectStore,
  projected: ReturnType<typeof projectLegacyTreeView>
): MessageActionViewState {
  const activePathByThreadId = new Map<string, readonly string[]>()
  const presentationByThreadId = new Map()
  for (const thread of Object.values(projected.threads)) {
    const ids = thread.messages.map((message) => message.id)
    activePathByThreadId.set(thread.id, ids)
    const latestUser = thread.messages.findLast((message) => message.role === "user")
    const latestAssistant = thread.messages.findLast(
      (message) => message.role === "assistant"
    )
    presentationByThreadId.set(thread.id, {
      latestUserMessageId: latestUser?.id,
      latestAssistantMessageId: latestAssistant?.id,
      alternatives: latestAssistant
        ? [{ assistantMessageId: latestAssistant.id, derivedThreadCount: 0 }]
        : [],
      sourceProvenance: null,
    })
  }
  return {
    recoverableByUserMessageId: new Map(),
    feedbackByMessageId: new Map(
      Object.values(state.entities.feedbackByMessageId)
        .filter((feedback) => feedback.value !== null)
        .map((feedback) => [feedback.messageId, feedback.value!])
    ),
    activePathByThreadId,
    presentationByThreadId,
  }
}

function scopeError(state: ThreadChatProjectStore, scope: string) {
  const command = state.requests.commandByScope[scope]
  return command?.status === "error" ? command.error.message : null
}

function currentSlotIdForThread(
  state: ThreadChatProjectStore,
  threadId: string
) {
  return state.ui.columnSlots.find((slot) => slot.threadId === threadId)?.slotId
}

export function ThreadChatProject({ projectId }: { projectId: string }) {
  const router = useRouter()
  const runtime = useThreadChatProjectRuntime()
  const state = useThreadChatStore((snapshot) => snapshot)
  const bootstrapReady = state.requests.bootstrap.status === "ready"
  useProjectWorkbench(runtime, bootstrapReady)
  const projected = useMemo(() => projectLegacyTreeView(state), [state])
  const [rootModelOverride, setRootModelId] = useState<string | null>(null)
  const root = Object.values(state.entities.threadsById).find(
    (thread) => thread.parentThreadId === null
  )
  const latestRootModelId = root
    ? (state.entities.messageIdsByThreadId[root.id] ?? [])
        .toReversed()
        .map((messageId) => state.runs.byAssistantMessageId[messageId]?.modelId)
        .find(Boolean)
    : undefined
  const rootModelId =
    rootModelOverride ?? latestRootModelId ?? DEFAULT_THREAD_CHAT_MODEL_ID
  const projectedStore = useProjectedThreadStore(
    state,
    projected,
    setRootModelId
  )
  const actionView = useMemo(
    () => messageActionView(state, projected),
    [projected, state]
  )
  const { windowWidth, autoColumnCount } = useColumnViewport()
  const totalColumns = state.ui.forceColumnCount ?? autoColumnCount
  const maxExpanded = Math.max(0, totalColumns - 1)
  const colsRef = useRef<HTMLDivElement | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)
  const [hintDismissed, setHintDismissed] = useState(false)
  const [focusNode, setFocusNode] = useState<{ id: string; n: number } | null>(
    null
  )
  const focusSequence = useRef(0)
  const canvasViewState = useMemo(
    () => ({
      pins: new Map(Object.entries(state.ui.canvasPins)),
      onPinsChange: (pins: ReadonlyMap<string, { x: number; y: number }>) => {
        const current = runtime.store.getState().ui.canvasPins
        for (const threadId of Object.keys(current))
          if (!pins.has(threadId)) runtime.store.getState().setCanvasPin(threadId, null)
        for (const [threadId, point] of pins)
          runtime.store.getState().setCanvasPin(threadId, point)
      },
    }),
    [runtime, state.ui.canvasPins]
  )
  const { toast, showToast, dismissToast } = useWorkspaceToast()
  const {
    rootRef,
    selection,
    setSelection,
    switcher,
    closeSwitcher,
    toggleGlobalSwitcher,
    openColumnSwitcher,
    openSubtree,
    treeList,
    closeTreeList,
    toggleTreeList,
    helpPanel,
    closeHelpPanel,
    openHelpPanel,
    drawerOpen,
    activeArtifactId,
    setActiveArtifactId,
    openArtifact,
    toggleDrawer,
    closeDrawer,
  } = useWorkspaceOverlays()

  useEffect(() => {
    if (!bootstrapReady) return
    const visible = [
      Object.values(state.entities.threadsById).find(
        (thread) => thread.parentThreadId === null
      )?.id,
      ...state.ui.columnSlots.map((slot) => slot.threadId),
    ].filter((threadId): threadId is string => Boolean(threadId))
    for (const threadId of visible)
      void runtime.commands.ensureThreadMessages(threadId)
  }, [bootstrapReady, runtime, state.entities.threadsById, state.ui.columnSlots])

  useEffect(() => {
    const expanded = state.ui.columnSlots.filter((slot) => !slot.folded)
    const excess = expanded.length - maxExpanded
    if (excess <= 0) return
    for (const slot of expanded.slice(0, excess))
      runtime.store.getState().closeColumn(slot.slotId)
  }, [maxExpanded, runtime, state.ui.columnSlots])

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    },
    []
  )

  const flash = useCallback((threadId: string) => {
    setFlashId(threadId)
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashId(null), 950)
  }, [])

  const rootThread = Object.values(state.entities.threadsById).find(
    (thread) => thread.parentThreadId === null
  )
  const slots: Slot[] = state.ui.columnSlots.map((slot) => ({
    id: slot.threadId,
    folded: slot.folded,
  }))
  const widths: Record<string, number> = {}
  if (rootThread && state.ui.rootColumnWidthPx !== null)
    widths[rootThread.id] = state.ui.rootColumnWidthPx
  for (const slot of state.ui.columnSlots)
    if (slot.widthPx !== null) widths[slot.threadId] = slot.widthPx

  const slotIdForThread = useCallback(
    (threadId: string): "root" | string =>
      rootThread?.id === threadId
        ? "root"
        : (state.ui.columnSlots.find((slot) => slot.threadId === threadId)
            ?.slotId ?? "root"),
    [rootThread?.id, state.ui.columnSlots]
  )

  const openThread = useCallback(
    (threadId: string, sourceThreadId: string | null = null) => {
      if (rootThread?.id === threadId) {
        flash(threadId)
        return
      }
      runtime.store
        .getState()
        .openThread(
          threadId,
          sourceThreadId ? slotIdForThread(sourceThreadId) : "root",
          { maxExpanded }
        )
      runtime.store.getState().setViewMode("columns")
      flash(threadId)
    },
    [flash, maxExpanded, rootThread?.id, runtime, slotIdForThread]
  )

  const activeAssistantId = (threadId: string) =>
    projected.threads[threadId]?.messages
      .toReversed()
      .find(
        (message) =>
          message.role === "assistant" &&
          (message.status === "pending" || message.status === "streaming")
      )?.id

  const messageCommands = useMemo<ThreadMessageActionCommands>(
    () => ({
      async retryAssistant(threadId, assistantMessageId) {
        await runtime.commands.regenerateMessage(assistantMessageId, rootModelId)
        const error = scopeError(
          runtime.store.getState(),
          `regenerate:${assistantMessageId}`
        )
        return error
          ? { ok: false, code: "network_error", message: error }
          : {
              ok: true,
              generationId: assistantMessageId,
              userMessageId: "",
              assistantMessageId,
            }
      },
      async retryUserTurn() {
        return {
          ok: false,
          code: "invalid_turn",
          message: "请编辑消息后重试",
        }
      },
      async editAndRegenerate(threadId, userMessageId, text) {
        await runtime.commands.editMessage(
          userMessageId,
          [{ type: "text", text }],
          rootModelId
        )
        const error = scopeError(runtime.store.getState(), `edit:${userMessageId}`)
        return error
          ? { ok: false, code: "network_error", message: error }
          : {
              ok: true,
              generationId: userMessageId,
              userMessageId,
              assistantMessageId: userMessageId,
            }
      },
      async switchTurnVariant() {
        return {
          ok: false,
          code: "invalid_turn",
          message: "该回复版本已被替换",
        }
      },
      async submitFeedback(threadId, messageId, feedback) {
        await runtime.commands.setFeedback(messageId, feedback)
        const value = runtime.store.getState().entities.feedbackByMessageId[messageId]
        return value?.value
          ? {
              messageId,
              feedback: value.value,
              updatedAt: value.updatedAt,
            }
          : null
      },
    }),
    [rootModelId, runtime]
  )

  const send = useCallback(
    async (threadId: string, text: string) => {
      await runtime.commands.sendMessage(
        threadId,
        [{ type: "text", text }],
        rootModelId
      )
      const error = scopeError(runtime.store.getState(), `send:${threadId}`)
      if (error) showToast(error)
    },
    [rootModelId, runtime, showToast]
  )

  const handleFork = useCallback(
    async (
      selection: SelectionInfo,
      hint?: PlacementHint,
      question?: string
    ) => {
      const before = new Set(Object.keys(runtime.store.getState().entities.threadsById))
      const sourceSlotId = slotIdForThread(selection.threadId)
      await runtime.commands.forkThread({
        sourceSlotId,
        placement: {
          maxExpanded,
          keepSource: hint?.keepSource,
          targetSlotId: hint?.targetId
            ? currentSlotIdForThread(runtime.store.getState(), hint.targetId)
            : undefined,
        },
        sourceThreadId: selection.threadId,
        sourceMessageId: selection.msgId,
        anchor: {
          exactQuote: selection.text,
          ...(selection.anchor.position
            ? { textPosition: selection.anchor.position }
            : {}),
        },
      })
      const current = runtime.store.getState()
      const created = Object.values(current.entities.threadsById).find(
        (thread) =>
          !before.has(thread.id) && thread.sourceMessageId === selection.msgId
      )
      if (!created) {
        const error = scopeError(current, `fork:${selection.msgId}`)
        showToast(error ?? "开启分支失败，请重试")
        return
      }
      if (question?.trim()) await send(created.id, question.trim())
      if (state.ui.viewMode === "canvas") {
        setFocusNode({ id: created.id, n: ++focusSequence.current })
        showToast(`已开启分支 · ${projected.threads[created.id]?.title ?? "新分支"}`)
      } else {
        flash(created.id)
      }
    },
    [flash, maxExpanded, projected.threads, runtime, send, showToast, slotIdForThread, state.ui.viewMode]
  )

  if (state.requests.bootstrap.status === "idle" || state.requests.bootstrap.status === "loading")
    return (
      <div className="tc">
        <div className="boot-loading">对话加载中…</div>
      </div>
    )

  if (state.requests.bootstrap.status === "error")
    return (
      <div className="tc">
        <div className="boot-loading">
          对话加载失败：{state.requests.bootstrap.error.message} ·{" "}
          <button onClick={() => void runtime.commands.loadProjectBootstrap()}>
            重试
          </button>
        </div>
      </div>
    )

  const mainHasMessage = rootThread
    ? (state.entities.messageIdsByThreadId[rootThread.id]?.length ?? 0) > 0
    : false
  const mainSubtitle =
    state.entities.project?.customTitle ??
    state.entities.project?.autoTitle ??
    "新对话"
  const hintVisible = !hintDismissed && !mainHasMessage
  const hintNode = hintVisible ? (
    <UsageHint onDismiss={() => setHintDismissed(true)} />
  ) : null
  const branchCount = Math.max(0, Object.keys(state.entities.threadsById).length - 1)
  const markdownCount = state.readModels.artifactSummary?.byKind.markdown ?? 0
  const activeArtifactLoadState = activeArtifactId
    ? state.requests.artifactById[activeArtifactId]
    : undefined

  const pickSwitcherRow = (row: { id: string }, mode: SwitcherMode) => {
    closeSwitcher()
    if (mode.kind === "column") {
      const slot = state.ui.columnSlots[mode.vpIndex]
      if (!slot) return
      if (row.id === rootThread?.id) runtime.store.getState().closeColumn(slot.slotId)
      else runtime.store.getState().switchColumnThread(slot.slotId, row.id)
      flash(row.id)
      return
    }
    openThread(row.id, mode.kind === "subtree" ? mode.rootId : null)
  }

  const canvasChat = {
    send: (threadId: string, text: string) => void send(threadId, text),
    stop: (threadId: string) => {
      const id = activeAssistantId(threadId)
      if (id) void runtime.commands.stopAssistant(id)
    },
    retry: (threadId: string, messageId: string) =>
      void runtime.commands.regenerateMessage(messageId, rootModelId),
    ...messageCommands,
  }

  return (
    <div className="tc" ref={rootRef}>
      <ThreadChatTopbar
        viewMode={state.ui.viewMode}
        showHelp={state.ui.viewMode === "canvas" || !hintVisible}
        windowWidth={windowWidth}
        forceCols={state.ui.forceColumnCount}
        placementMode={state.ui.placementMode}
        branchCount={branchCount}
        markdownCount={markdownCount}
        onNewConversation={() => router.push("/thread-chat/new")}
        onToggleTreeList={toggleTreeList}
        onOpenHelp={openHelpPanel}
        onShowColumns={() => runtime.store.getState().setViewMode("columns")}
        onShowCanvas={() => runtime.store.getState().setViewMode("canvas")}
        onForceCols={(count) => runtime.store.getState().setForceColumnCount(count)}
        onPlacementModeChange={(mode) => {
          runtime.store.getState().setPlacementMode(mode)
          if (mode === "replace")
            for (const slot of runtime.store.getState().ui.columnSlots)
              if (slot.folded)
                runtime.store.getState().setColumnFolded(slot.slotId, false)
        }}
        onToggleThreadTree={toggleGlobalSwitcher}
        onToggleMarkdown={toggleDrawer}
      />

      {state.ui.viewMode === "columns" ? (
        <ThreadColumns
          state={projected}
          slots={slots}
          widths={widths}
          flashId={flashId}
          colsRef={colsRef}
          onExpandStrip={(threadId) => {
            const slot = runtime.store.getState().ui.columnSlots.find(
              (candidate) => candidate.threadId === threadId
            )
            if (slot) runtime.store.getState().setColumnFolded(slot.slotId, false)
          }}
          onCommitWidths={(patch) => {
            const widthsBySlot: Partial<Record<"root" | string, number | null>> = {}
            for (const [threadId, width] of Object.entries(patch))
              widthsBySlot[slotIdForThread(threadId)] = width
            runtime.store.getState().commitColumnWidths(widthsBySlot)
          }}
          onResetWidths={() => {
            const reset: Partial<Record<"root" | string, number | null>> = {
              root: null,
            }
            for (const slot of runtime.store.getState().ui.columnSlots)
              reset[slot.slotId] = null
            runtime.store.getState().commitColumnWidths(reset)
          }}
          renderThread={(threadId, viewportIndex) => {
            const slotId = viewportIndex < 0 ? "root" : state.ui.columnSlots[viewportIndex]?.slotId
            if (!slotId) return null
            const columnView = selectThreadColumnView(state, slotId)
            const headerView = selectThreadColumnHeaderView(state, slotId)
            const loadingIntro =
              columnView.status === "loading" ? (
                <div className="boot-loading">对话加载中…</div>
              ) : columnView.status === "error" ? (
                <button
                  className="boot-loading"
                  onClick={() => void runtime.commands.ensureThreadMessages(threadId)}
                >
                  加载失败，点击重试
                </button>
              ) : undefined
            const busy = Boolean(activeAssistantId(threadId))
            return (
              <div
                data-column-view-status={columnView.status}
                data-column-header-title={headerView.title}
                style={{ display: "contents" }}
              >
                <BranchableChat
                  state={projected}
                  threadId={threadId}
                  subtitle={threadId === rootThread?.id ? mainSubtitle : undefined}
                  intro={loadingIntro ?? (threadId === rootThread?.id ? hintNode : undefined)}
                  onOpenThread={(target) => openThread(target, threadId)}
                  onOpenArtifact={(artifactId) => {
                    void runtime.commands.ensureArtifact(artifactId)
                    openArtifact(artifactId)
                  }}
                  onCrumbNav={(target) => {
                    if (target === rootThread?.id) {
                      runtime.store.getState().closeColumn(slotId)
                    } else {
                      const existing = runtime.store
                        .getState()
                        .ui.columnSlots.find(
                          (candidate) => candidate.threadId === target
                        )
                      if (existing && existing.slotId !== slotId) {
                        runtime.store.getState().closeColumn(slotId)
                        runtime.store.getState().focusColumn(existing.slotId)
                      } else {
                        runtime.store
                          .getState()
                          .switchColumnThread(slotId, target)
                      }
                    }
                    flash(target)
                  }}
                  onOpenSwitcher={(button) =>
                    openColumnSwitcher(viewportIndex, button)
                  }
                  onOpenSubtree={(button) => openSubtree(threadId, button)}
                  onCollapse={() => runtime.store.getState().closeColumn(slotId)}
                  busy={busy}
                  onRetry={(message) =>
                    void runtime.commands.regenerateMessage(message.id, rootModelId)
                  }
                  onStop={() => {
                    const id = activeAssistantId(threadId)
                    if (id) void runtime.commands.stopAssistant(id)
                  }}
                  composerPrefill={
                    projected.threads[threadId]?.messages.length === 0
                      ? kickoffQuestion(projected.threads[threadId]?.anchorText ?? "")
                      : undefined
                  }
                  onModelChange={setRootModelId}
                  onSend={(text) => void send(threadId, text)}
                  messageActionState={actionView}
                  messageCommands={messageCommands}
                />
              </div>
            )
          }}
        />
      ) : (
        <ThreadCanvas
          store={projectedStore}
          mainSubtitle={mainSubtitle}
          viewState={canvasViewState}
          chat={canvasChat}
          messageActionState={actionView}
          focusNode={focusNode}
          onOpenThread={(threadId) => {
            runtime.store.getState().setViewMode("columns")
            openThread(threadId)
          }}
          onOpenArtifact={(artifactId) => {
            void runtime.commands.ensureArtifact(artifactId)
            openArtifact(artifactId)
          }}
        />
      )}

      <SelectionBubble
        state={projected}
        sel={selection}
        onSelChange={setSelection}
        onFork={(selection, hint, question) =>
          void handleFork(selection, hint, question)
        }
        slots={state.ui.viewMode === "canvas" ? EMPTY_SLOTS : slots}
        mode={state.ui.placementMode}
        maxExpanded={maxExpanded}
        lastActiveOf={(threadId) => projected.threads[threadId]?.lastActive ?? 0}
      />

      {treeList && (
        <ProjectList
          key={treeList.n}
          currentProjectId={projectId}
          closing={treeList.closing}
          container={rootRef}
          onClose={closeTreeList}
          onToast={showToast}
        />
      )}
      {switcher && (
        <ThreadSwitcher
          key={switcher.n}
          state={projected}
          mode={switcher}
          slots={slots}
          recents={projected.recents}
          closing={switcher.closing}
          container={rootRef}
          onPick={pickSwitcherRow}
          onClose={closeSwitcher}
        />
      )}
      {helpPanel && (
        <HelpPanel
          key={helpPanel.n}
          closing={helpPanel.closing}
          container={rootRef}
          onClose={closeHelpPanel}
        />
      )}
      <ArtifactDrawer
        state={projected}
        open={drawerOpen}
        activeId={activeArtifactId}
        onClose={closeDrawer}
        onSelect={(artifactId) => {
          void runtime.commands.ensureArtifact(artifactId)
          setActiveArtifactId(artifactId)
        }}
        onLocate={(threadId) => openThread(threadId)}
        loadState={
          activeArtifactLoadState?.status === "error"
            ? {
                status: "error",
                message: activeArtifactLoadState.error.message,
                onRetry: () => {
                  if (activeArtifactId)
                    void runtime.commands.ensureArtifact(activeArtifactId)
                },
              }
            : activeArtifactLoadState
        }
      />
      <WorkspaceToast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
