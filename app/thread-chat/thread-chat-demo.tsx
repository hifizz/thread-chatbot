"use client"

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import React, { useCallback, useEffect, useMemo, useState } from "react"

import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/model"
import { MESSAGE_FORK_LABELS } from "@/constants/message-fork"
import { PROJECT_TITLE_FALLBACK } from "@/constants/project-workspace"
import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import { textFromMessageParts } from "@/lib/thread-chat/contracts/ui-message"
import {
  activePathArtifacts,
  threadTitle,
  type TreeRow,
} from "./core/selectors"
import { useConversationStore } from "./core/use-thread-store"
import {
  fromConversationViewThreadId,
  projectConversationTree,
} from "./core/projections"
import { createProjectedConversationStore } from "./core/projected-store"
import {
  useProjectListStore,
  useProjectListStoreApi,
} from "./core/project-list-store"
import { selectThreadBusy, selectVisibleMessages } from "./core/selectors"
import type { Message, MessageFeedback } from "./core/types"
import { BranchableChat } from "./branching/branchable-chat"
import {
  SelectionBubble,
  type SelectionInfo,
} from "./branching/selection/selection-bubble"
import { buildMessageActionViewState } from "./chat/actions/message-action-presentation"
import type {
  GenerationActionResult,
  ThreadMessageActionCommands,
} from "./chat/actions/message-action-commands"
import type { MessageActionViewState } from "./chat/actions/message-action-types"
import { kickoffQuestion } from "./net/prompt/prompt-pure"
import type { CommandFileReference } from "./net/commands/conversation-commands"
import { removeWorkspaceState } from "./net/persistence/workspace-state"
import { ThreadColumns } from "./orchestration/columns/thread-columns"
import type {
  PlacementHint,
  PlacementMode,
} from "./orchestration/columns/placement"
import {
  ThreadChatMobileMenu,
  type ThreadChatNavigationProps,
  ThreadChatTopbar,
} from "./orchestration/navigation/thread-chat-topbar"
import {
  ThreadSwitcher,
  type SwitcherMode,
} from "./orchestration/navigation/thread-switcher"
import { TreeList } from "./orchestration/navigation/tree-list"
import { StoreBoundProjectPanel } from "./orchestration/artifacts/store-bound-project-panel"
import type { CanvasChatActions } from "./orchestration/canvas/canvas-actions"
import { HelpPanel, UsageHint } from "./orchestration/overlays/help-panel"
import { useWorkspaceOverlays } from "./orchestration/overlays/use-workspace-overlays"
import {
  useWorkspaceToast,
  WorkspaceToast,
} from "./orchestration/overlays/workspace-toast"
import { useConversationRuntime } from "./orchestration/workspace/use-conversation-runtime"
import { useNormalizedWorkspace } from "./orchestration/workspace/use-normalized-workspace"

const ThreadCanvas = dynamic(
  () =>
    import("./orchestration/canvas/thread-canvas").then(
      (module) => module.ThreadCanvas
    ),
  {
    ssr: false,
    loading: () => <div className="canvas-loading">画布加载中…</div>,
  }
)

const MAIN_SUBTITLE_MAX_LEN = 28
const EMPTY_SLOTS: [] = []

function compactTitle(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function messageFileReferences(message: MessageDTO): CommandFileReference[] {
  return message.parts.flatMap((part) =>
    part.type === "file"
      ? [
          {
            url: part.url,
            mediaType: part.mediaType,
            ...(part.filename ? { filename: part.filename } : {}),
          },
        ]
      : []
  )
}

function legacyFeedback(value: "up" | "down" | null): MessageFeedback | null {
  return value === "up" ? "positive" : value === "down" ? "negative" : null
}

function normalizedFeedback(
  value: MessageFeedback | null
): "up" | "down" | null {
  return value === "positive" ? "up" : value === "negative" ? "down" : null
}

function actionResult(input: {
  userMessageId?: string
  assistantMessageId: string
  sourceUserMessageId?: string
  sourceAssistantMessageId?: string
}): GenerationActionResult {
  return {
    ok: true,
    generationId: input.assistantMessageId,
    userMessageId: input.userMessageId ?? input.assistantMessageId,
    assistantMessageId: input.assistantMessageId,
    ...(input.sourceUserMessageId
      ? { sourceUserMessageId: input.sourceUserMessageId }
      : {}),
    ...(input.sourceAssistantMessageId
      ? { sourceAssistantMessageId: input.sourceAssistantMessageId }
      : {}),
  }
}

function actionFailure(error: unknown): GenerationActionResult {
  return {
    ok: false,
    code: "network_error",
    message: error instanceof Error ? error.message : "请求失败，请重试",
  }
}

export function ThreadChatDemo({ treeId }: { treeId: string }) {
  const runtime = useConversationRuntime(treeId)
  if (runtime.status === "loading") {
    return (
      <div className="tc">
        <div className="boot-loading">对话加载中…</div>
      </div>
    )
  }
  if (runtime.status === "error") {
    return (
      <div className="tc">
        <div className="boot-loading">对话加载失败，请刷新重试。</div>
      </div>
    )
  }
  return <NormalizedThreadChat treeId={treeId} runtime={runtime} />
}

function NormalizedThreadChat({
  treeId,
  runtime,
}: {
  treeId: string
  runtime: ReturnType<typeof useConversationRuntime>
}) {
  const router = useRouter()
  const state = useConversationStore(runtime.store, (value) => value)
  const [draftModelId, setDraftModelId] = useState<string>(
    DEFAULT_THREAD_CHAT_MODEL_ID
  )
  const projectListStore = useProjectListStoreApi()
  const projectList = useProjectListStore((value) => value)
  const currentProjectId = state.project?.id
  const { toast, showToast, dismissToast } = useWorkspaceToast()
  const setThreadModel = useCallback(
    (threadId: string, modelId: string) => {
      const current = runtime.store.getState()
      if (!current.project || !current.threadsById[threadId]) {
        setDraftModelId(modelId)
        return
      }
      void runtime.commands
        .updateThread(threadId, { modelId })
        .catch(() => showToast("模型切换失败，请重试"))
    },
    [runtime.commands, runtime.store, showToast]
  )
  const projectedStore = useMemo(
    () =>
      createProjectedConversationStore({
        store: runtime.store,
        setThreadModel,
        emptyRootModelId: draftModelId,
      }),
    [draftModelId, runtime.store, setThreadModel]
  )
  useEffect(() => () => projectedStore.dispose(), [projectedStore])

  const tree = useMemo(() => {
    const projected = projectConversationTree(state)
    if (!state.project) projected.threads.main.modelId = draftModelId
    return projected
  }, [draftModelId, state])
  const workspace = useNormalizedWorkspace({
    store: runtime.store,
    projectedStore,
  })
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
  const [hintDismissed, setHintDismissed] = useState(false)

  const feedbackByMessageId = useMemo(
    () =>
      new Map(
        Object.values(state.messagesById).flatMap((message) => {
          const feedback = legacyFeedback(message.feedback)
          return feedback ? [[message.id, feedback] as const] : []
        })
      ),
    [state.messagesById]
  )
  const messageActionState = useMemo<MessageActionViewState>(
    () =>
      buildMessageActionViewState({
        state: tree,
        recoverableByUserMessageId: new Map(),
        feedbackByMessageId,
      }),
    [feedbackByMessageId, tree]
  )

  const messageCommands = useMemo<ThreadMessageActionCommands>(
    () => ({
      async retryAssistant(viewThreadId, assistantMessageId) {
        try {
          const threadId = fromConversationViewThreadId(state, viewThreadId)
          const result = await runtime.commands.retryMessage({
            messageId: assistantMessageId,
            modelId:
              state.threadsById[threadId]?.modelId ??
              DEFAULT_THREAD_CHAT_MODEL_ID,
          })
          return actionResult({
            assistantMessageId: result.command.assistantMessageId,
            sourceAssistantMessageId: assistantMessageId,
          })
        } catch (error) {
          return actionFailure(error)
        }
      },
      async retryUserTurn(viewThreadId, userMessageId) {
        try {
          const threadId = fromConversationViewThreadId(state, viewThreadId)
          const source = state.messagesById[userMessageId]
          if (!source)
            return { ok: false, code: "not_found", message: "消息不存在" }
          const assistant = selectVisibleMessages(state, threadId).find(
            (message) =>
              message.role === "assistant" && message.sequence > source.sequence
          )
          const result = await runtime.commands.editLatestTurn({
            userMessageId,
            assistantMessageId: assistant?.id,
            modelId:
              state.threadsById[threadId]?.modelId ??
              DEFAULT_THREAD_CHAT_MODEL_ID,
            text: textFromMessageParts(source.parts),
            files: messageFileReferences(source),
          })
          return actionResult({
            userMessageId: result.command.userMessageId,
            assistantMessageId: result.command.assistantMessageId,
            sourceUserMessageId: userMessageId,
            sourceAssistantMessageId: assistant?.id,
          })
        } catch (error) {
          return actionFailure(error)
        }
      },
      async editAndRegenerate(viewThreadId, userMessageId, text) {
        try {
          const threadId = fromConversationViewThreadId(state, viewThreadId)
          const source = state.messagesById[userMessageId]
          const assistant = source
            ? selectVisibleMessages(state, threadId).find(
                (message) =>
                  message.role === "assistant" &&
                  message.sequence > source.sequence
              )
            : undefined
          const result = await runtime.commands.editLatestTurn({
            userMessageId,
            assistantMessageId: assistant?.id,
            modelId:
              state.threadsById[threadId]?.modelId ??
              DEFAULT_THREAD_CHAT_MODEL_ID,
            text,
            files: source ? messageFileReferences(source) : [],
          })
          return actionResult({
            userMessageId: result.command.userMessageId,
            assistantMessageId: result.command.assistantMessageId,
            sourceUserMessageId: userMessageId,
            sourceAssistantMessageId: assistant?.id,
          })
        } catch (error) {
          return actionFailure(error)
        }
      },
      async submitFeedback(viewThreadId, messageId, feedback) {
        const result = await runtime.commands.setFeedback(
          messageId,
          normalizedFeedback(feedback)
        )
        if (!feedback) return null
        return {
          treeId,
          threadId: fromConversationViewThreadId(state, viewThreadId),
          messageId,
          feedback,
          updatedAt: result.response.data.updatedAt,
        }
      },
    }),
    [runtime.commands, state, treeId]
  )

  const send = useCallback(
    (viewThreadId: string, text: string, files: CommandFileReference[] = []) => {
      const current = runtime.store.getState()
      const normalizedThreadId = fromConversationViewThreadId(
        current,
        viewThreadId
      )
      const operation = current.project
        ? runtime.commands.sendMessage({
            threadId: normalizedThreadId,
            modelId:
              current.threadsById[normalizedThreadId]?.modelId ?? draftModelId,
            text,
            files,
          })
        : runtime.commands.startProject({
            projectId: treeId,
            modelId: draftModelId,
            text,
            files,
          })
      void operation.catch((error) =>
        showToast(error instanceof Error ? error.message : "发送失败，请重试")
      )
    },
    [draftModelId, runtime.commands, runtime.store, showToast, treeId]
  )
  const stop = useCallback(
    (viewThreadId: string) => {
      const current = runtime.store.getState()
      const threadId = fromConversationViewThreadId(current, viewThreadId)
      const active = [...selectVisibleMessages(current, threadId)]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" && message.status === "generating"
        )
      if (!active) return
      void runtime.commands
        .stopMessage(active.id)
        .catch(() => showToast("停止失败，请重试"))
    },
    [runtime.commands, runtime.store, showToast]
  )
  const retry = useCallback(
    (viewThreadId: string, message: Message) => {
      void messageCommands.retryAssistant(viewThreadId, message.id)
    },
    [messageCommands]
  )

  const openBranchUI = useCallback(
    (id: string, sourceId?: string | null, hint?: PlacementHint) => {
      workspace.showColumnsView()
      if (id === "main") {
        workspace.columns.flashThread("main")
        return
      }
      const effect = workspace.columns.openThread(id, sourceId ?? null, hint)
      if (effect.kind === "replaced") {
        showToast(
          `第 ${effect.idx + 2} 列已替换：「${threadTitle(tree, effect.replacedId)}」→「${threadTitle(tree, id)}」`,
          () => {
            workspace.columns.restoreSlots(effect.prevSlots)
            workspace.columns.flashThread(effect.replacedId)
          }
        )
      } else if (effect.kind === "folded") {
        showToast(
          `已打开「${threadTitle(tree, id)}」，「${threadTitle(tree, effect.foldedId)}」已折叠为细条`
        )
      }
    },
    [showToast, tree, workspace]
  )

  const handleFork = useCallback(
    (
      info: Pick<SelectionInfo, "threadId" | "msgId"> &
        Partial<Pick<SelectionInfo, "text" | "anchor">>,
      hint?: PlacementHint,
      question?: string
    ) => {
      const current = runtime.store.getState()
      const parentThreadId = fromConversationViewThreadId(
        current,
        info.threadId
      )
      const modelId =
        current.threadsById[parentThreadId]?.modelId ??
        DEFAULT_THREAD_CHAT_MODEL_ID
      return runtime.commands
        .forkThread({
          parentThreadId,
          sourceMessageId: info.msgId,
          anchorText: info.text,
          anchor: info.anchor,
          modelId,
          ...(question?.trim() ? { text: question.trim() } : {}),
        })
        .then(({ command }) => {
          const text = info.text ?? MESSAGE_FORK_LABELS.untitled
          const title = text.length > 13 ? `${text.slice(0, 13)}…` : text
          if (workspace.viewMode === "canvas") {
            workspace.focusCanvasNode(command.threadId)
            showToast(`已开启分支 · ${title}`)
            return
          }
          openBranchUI(command.threadId, info.threadId, hint)
          showToast(`已开启分支 · ${title}`)
        })
        .catch(() => showToast(MESSAGE_FORK_LABELS.failed))
    },
    [openBranchUI, runtime.commands, runtime.store, showToast, workspace]
  )

  const changeMode = useCallback(
    (nextMode: PlacementMode) => {
      if (nextMode === workspace.mode) return
      workspace.setMode(nextMode)
      if (nextMode !== "replace") return
      const dropped = workspace.columns.normalizeToReplace()
      if (dropped.length)
        showToast(
          `已切回替换⑥：细条全部展开后，超出列数的「${dropped
            .map((id) => threadTitle(tree, id))
            .join("」「")}」已收起`
        )
    },
    [showToast, tree, workspace]
  )

  const pickRow = useCallback(
    (row: TreeRow, mode: SwitcherMode) => {
      closeSwitcher()
      if (mode.kind === "column") {
        if (workspace.columns.slots[mode.vpIndex]?.id === row.id) {
          workspace.columns.flashThread(row.id)
          return
        }
        workspace.columns.navColumn(mode.vpIndex, row.id, "swap")
      } else if (mode.kind === "subtree") {
        openBranchUI(row.id, mode.rootId)
      } else {
        openBranchUI(row.id, null)
      }
    },
    [closeSwitcher, openBranchUI, workspace.columns]
  )

  const canvasChat = useMemo<CanvasChatActions>(
    () => ({
      send,
      stop,
      forkMessage: (threadId, msgId) => handleFork({ threadId, msgId }),
      retry(viewThreadId, messageId) {
        void messageCommands.retryAssistant(viewThreadId, messageId)
      },
      ...messageCommands,
    }),
    [handleFork, messageCommands, send, stop]
  )

  const renameTreeItem = useCallback(
    async (projectId: string, title: string) => {
      const cache = projectListStore.getState()
      const previousTitle = cache.items?.find(
        (item) => item.id === projectId
      )?.title
      cache.setTitle(projectId, title)
      try {
        if (projectId === currentProjectId) {
          await runtime.commands.renameProject(projectId, title)
        } else {
          await runtime.client.renameProject(projectId, {
            commandId: crypto.randomUUID(),
            customTitle: title,
          })
        }
      } catch (error) {
        if (previousTitle !== undefined)
          projectListStore
            .getState()
            .restoreTitle(projectId, title, previousTitle)
        throw error
      }
    },
    [currentProjectId, projectListStore, runtime.client, runtime.commands]
  )
  const deleteTreeItem = useCallback(
    async (projectId: string) => {
      if (projectId === currentProjectId)
        await runtime.commands.deleteProject(projectId)
      else
        await runtime.client.deleteProject(projectId, {
          commandId: crypto.randomUUID(),
        })
      removeWorkspaceState(window.localStorage, projectId)
      projectListStore.getState().remove(projectId)
    },
    [currentProjectId, projectListStore, runtime.client, runtime.commands]
  )

  const mainHasMessage = (tree.threads.main?.messages.length ?? 0) > 0
  const firstUserText = tree.threads.main?.messages
    .find((message) => message.role === "user")
    ?.text.trim()
  const derivedSubtitle = firstUserText
    ? compactTitle(firstUserText, MAIN_SUBTITLE_MAX_LEN)
    : PROJECT_TITLE_FALLBACK
  const mainSubtitle =
    state.project?.customTitle ?? state.project?.autoTitle ?? derivedSubtitle
  const hintVisible = !hintDismissed && !mainHasMessage
  const branchCount = Math.max(0, Object.keys(tree.threads).length - 1)
  const markdownCount = activePathArtifacts(tree).reduce(
    (count, artifact) => count + (artifact.kind === "markdown" ? 1 : 0),
    0
  )
  const navigationProps: ThreadChatNavigationProps = {
    viewMode: workspace.viewMode,
    showHelp: workspace.viewMode === "canvas" || !hintVisible,
    windowWidth: workspace.windowWidth,
    forceCols: workspace.forceCols,
    placementMode: workspace.mode,
    branchCount,
    markdownCount,
    onNewConversation: (openInNewPage) => {
      const newConversationUrl = `/thread-chat/${crypto.randomUUID()}`
      if (openInNewPage) {
        window.open(newConversationUrl, "_blank", "noopener,noreferrer")
        return
      }

      // 空树已经是新对话；反复点击不应让 URL 持续变化。
      if (!mainHasMessage) {
        showToast("当前就是全新对话，直接开聊吧")
        return
      }
      router.push(newConversationUrl)
    },
    onToggleTreeList: toggleTreeList,
    onOpenHelp: openHelpPanel,
    onShowColumns: workspace.showColumnsView,
    onShowCanvas: () => workspace.setViewMode("canvas"),
    onForceCols: workspace.setForceCols,
    onPlacementModeChange: changeMode,
    onToggleThreadTree: toggleGlobalSwitcher,
    onToggleMarkdown: toggleDrawer,
  }

  return (
    <div
      className="tc"
      data-view-mode={workspace.viewMode}
      ref={rootRef}
    >
      <ThreadChatTopbar {...navigationProps} />

      {workspace.viewMode === "columns" ? (
        <ThreadColumns
          state={tree}
          slots={workspace.columns.slots}
          widths={workspace.columns.widths}
          flashId={workspace.columns.flashId}
          colsRef={workspace.columns.colsRef}
          onExpandStrip={(id) => openBranchUI(id, null)}
          onCommitWidths={workspace.columns.commitWidths}
          onResetWidths={workspace.columns.resetWidths}
          renderThread={(viewThreadId, viewportIndex) => {
            const threadId = fromConversationViewThreadId(state, viewThreadId)
            const thread = tree.threads[viewThreadId]
            return (
              <BranchableChat
                state={tree}
                threadId={viewThreadId}
                subtitle={viewThreadId === "main" ? mainSubtitle : undefined}
                mainHeaderActions={
                  viewThreadId === "main" ? (
                    <ThreadChatMobileMenu {...navigationProps} />
                  ) : undefined
                }
                intro={
                  viewThreadId === "main" && hintVisible ? (
                    <UsageHint onDismiss={() => setHintDismissed(true)} />
                  ) : undefined
                }
                onOpenThread={(target, options) =>
                  openBranchUI(target, viewThreadId, options)
                }
                onOpenArtifact={openArtifact}
                onForkMessage={(message) => handleFork({
                  threadId: viewThreadId,
                  msgId: message.id,
                })}
                onCrumbNav={(target) =>
                  workspace.columns.navColumn(viewportIndex, target, "collapse")
                }
                onOpenSwitcher={(button) =>
                  openColumnSwitcher(viewportIndex, button)
                }
                onOpenSubtree={(button) => openSubtree(viewThreadId, button)}
                onCollapse={() => workspace.columns.closeColumn(viewportIndex)}
                busy={
                  Boolean(state.project) && selectThreadBusy(state, threadId)
                }
                composerPrefill={
                  thread?.anchorText && thread.messages.length === 0
                    ? kickoffQuestion(thread.anchorText)
                    : undefined
                }
                onModelChange={(modelId) => {
                  if (!state.project) setDraftModelId(modelId)
                  else setThreadModel(threadId, modelId)
                }}
                onRetry={(message) => retry(viewThreadId, message)}
                onStop={() => stop(viewThreadId)}
                onSend={(text, files) => send(viewThreadId, text, files)}
                messageActionState={messageActionState}
                messageCommands={messageCommands}
              />
            )
          }}
        />
      ) : (
        <ThreadCanvas
          store={projectedStore}
          mainSubtitle={mainSubtitle}
          viewState={workspace.canvasViewState}
          chat={canvasChat}
          messageActionState={messageActionState}
          focusNode={workspace.focusNode}
          onOpenThread={(id) => openBranchUI(id, null)}
          onOpenArtifact={openArtifact}
        />
      )}

      <SelectionBubble
        state={tree}
        sel={selection}
        onSelChange={setSelection}
        onFork={handleFork}
        slots={
          workspace.viewMode === "canvas"
            ? EMPTY_SLOTS
            : workspace.columns.slots
        }
        mode={workspace.mode}
        maxExpanded={workspace.maxExpanded}
        lastActiveOf={(id) => tree.threads[id]?.lastActive ?? 0}
      />

      {treeList !== null && (
        <TreeList
          key={treeList.n}
          currentTreeId={treeId}
          currentTitle={mainSubtitle ?? PROJECT_TITLE_FALLBACK}
          currentThreadCount={Object.keys(tree.threads).length}
          items={projectList.items}
          refreshing={projectList.refreshing}
          loadFailed={projectList.loadFailed}
          refreshItems={projectList.refresh}
          renameItem={renameTreeItem}
          deleteItem={deleteTreeItem}
          closing={treeList.closing}
          container={rootRef}
          onClose={closeTreeList}
          onSwitch={(id) => router.push(`/thread-chat/${id}`)}
          onDeleteCurrent={(nextId) => {
            closeTreeList()
            router.replace(`/thread-chat/${nextId ?? crypto.randomUUID()}`)
          }}
          onToast={showToast}
        />
      )}

      {switcher && (
        <ThreadSwitcher
          key={switcher.n}
          state={tree}
          mode={switcher}
          slots={workspace.columns.slots}
          recents={tree.recents}
          closing={switcher.closing}
          container={rootRef}
          onPick={pickRow}
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

      <StoreBoundProjectPanel
        projectId={treeId}
        store={runtime.store}
        client={runtime.client}
        commands={runtime.commands}
        open={drawerOpen}
        activeId={activeArtifactId}
        onClose={closeDrawer}
        onSelect={setActiveArtifactId}
        onLocate={(threadId) => openBranchUI(threadId, null)}
      />
      <WorkspaceToast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
