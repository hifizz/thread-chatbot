"use client"

import dynamic from "next/dynamic"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { createConversationStore, type ConversationStore } from "../core/store"
import { useConversationStore } from "../core/use-thread-store"
import {
  fromConversationViewThreadId,
  projectConversationTree,
} from "../core/projections"
import { selectThreadBusy, selectVisibleMessages } from "../core/selectors"
import {
  createConversationCommands,
  type ConversationCommands,
} from "../net/commands/conversation-commands"
import { pollBackgroundGeneration } from "../net/stream/generation-connection"
import {
  loadWorkspaceState,
  saveWorkspaceState,
} from "../net/persistence/workspace-state"
import { buildMessageActionViewState } from "../chat/actions/message-action-presentation"
import type {
  GenerationActionResult,
  ThreadMessageActionCommands,
} from "../chat/actions/message-action-commands"
import type { MessageActionViewState } from "../chat/actions/message-action-types"
import { textFromMessageParts } from "@/lib/thread-chat/contracts/ui-message"
import type { Message, MessageFeedback } from "../core/types"
import { BranchableChat } from "../branching/branchable-chat"
import {
  SelectionBubble,
  type SelectionInfo,
} from "../branching/selection/selection-bubble"
import { kickoffQuestion } from "../net/prompt/prompt-pure"
import { ThreadColumns } from "../orchestration/columns/thread-columns"
import type { Slot } from "../orchestration/columns/placement"
import { ThreadChatTopbar } from "../orchestration/navigation/thread-chat-topbar"
import { ArtifactDrawer } from "../orchestration/artifacts/artifact-drawer"
import type { CanvasChatActions } from "../orchestration/canvas/canvas-actions"
import type { CanvasViewState } from "../orchestration/canvas/use-canvas-layout"
import {
  createGate3MockRuntime,
  GATE3_HARNESS_IDS,
  type Gate3HarnessScenario,
} from "./mock-v1-runtime"

const ThreadCanvas = dynamic(
  () =>
    import("../orchestration/canvas/thread-canvas").then(
      (module) => module.ThreadCanvas
    ),
  { ssr: false }
)

const SCENARIOS: Array<{ id: Gate3HarnessScenario; label: string }> = [
  { id: "normal", label: "正常流" },
  { id: "late-sse", label: "迟到 SSE" },
  { id: "disconnect", label: "断流→轮询" },
  { id: "failure", label: "可重试失败" },
  { id: "artifact", label: "Artifact-only" },
  { id: "research", label: "研究 parts" },
]

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

function createProjectedCanvasStore(
  store: ConversationStore,
  commands: ConversationCommands
) {
  const revision = { value: 0 }
  const listeners = new Set<() => void>()
  const unsubscribe = store.subscribe(() => {
    revision.value += 1
    listeners.forEach((listener) => listener())
  })
  return {
    getState: () => projectConversationTree(store.getState()),
    getVersion: () => revision.value,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setThreadModel(viewThreadId: string, modelId: string) {
      const state = store.getState()
      const threadId = fromConversationViewThreadId(state, viewThreadId)
      void commands.updateThread(threadId, { modelId })
    },
    dispose: unsubscribe,
  }
}

export function NormalizedGate3Harness({
  projectId,
  backgroundRecovery = false,
}: {
  projectId: string
  backgroundRecovery?: boolean
}) {
  const [runtime] = useState(() => {
    const mock = createGate3MockRuntime(projectId, { backgroundRecovery })
    const store = createConversationStore({ bootstrap: mock.bootstrap })
    const commands = createConversationCommands({
      store,
      client: mock.client,
      fetch: mock.fetchStream,
      pollDelays: [30, 60, 100],
    })
    return { mock, store, commands }
  })
  const state = useConversationStore(runtime.store, (value) => value)
  const tree = useMemo(() => projectConversationTree(state), [state])
  const [scenario, setScenario] = useState<Gate3HarnessScenario>("normal")
  const [status, setStatus] = useState("开发 harness 已就绪")
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [forceCols, setForceCols] = useState<number | null>(3)
  const [placementMode, setPlacementMode] = useState<"replace" | "fold">(
    "replace"
  )
  const [titleDraft, setTitleDraft] = useState("规范化会话验收")
  const columnsRef = useRef<HTMLDivElement | null>(null)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [canvasViewState] = useState<CanvasViewState>(() => ({
    pins: new Map(),
  }))
  const [windowWidth, setWindowWidth] = useState<number | null>(null)

  useEffect(() => {
    const updateWindowWidth = () => setWindowWidth(window.innerWidth)
    updateWindowWidth()
    window.addEventListener("resize", updateWindowWidth)
    return () => window.removeEventListener("resize", updateWindowWidth)
  }, [])

  useEffect(() => {
    const saved = loadWorkspaceState(window.localStorage, projectId)
    if (saved) runtime.store.getState().setWorkspace(saved)
    const unsubscribe = runtime.store.subscribe((next, previous) => {
      if (next.workspace !== previous.workspace)
        saveWorkspaceState(window.localStorage, projectId, next.workspace)
    })
    const background = runtime.mock.bootstrap.activeGenerationIds.map(
      (messageId) =>
        pollBackgroundGeneration({
          store: runtime.store,
          client: runtime.mock.client,
          messageId,
          pollDelays: [700, 700],
        })
    )
    return () => {
      unsubscribe()
      background.forEach((connection) => connection.close())
      runtime.commands.dispose()
    }
  }, [projectId, runtime])

  const rootId = state.project?.rootThreadId ?? GATE3_HARNESS_IDS.rootThreadId
  const viewMode = state.workspace.view
  const slots: Slot[] = state.workspace.openThreadIds
    .filter(
      (threadId) => threadId !== rootId && Boolean(state.threadsById[threadId])
    )
    .map((id) => ({ id, folded: false }))
  const openThread = (viewThreadId: string) => {
    const threadId = fromConversationViewThreadId(state, viewThreadId)
    if (threadId === rootId) {
      runtime.store.getState().setWorkspace({ selectedThreadId: rootId })
      return
    }
    runtime.store.getState().setWorkspace({
      selectedThreadId: threadId,
      openThreadIds: [
        ...state.workspace.openThreadIds.filter((id) => id !== threadId),
        threadId,
      ].slice(-Math.max(1, (forceCols ?? 3) - 1)),
      recents: [
        threadId,
        ...state.workspace.recents.filter((id) => id !== threadId),
      ].slice(0, 6),
    })
  }

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
        const result = await runtime.commands.retryMessage({
          messageId: assistantMessageId,
          modelId:
            state.threadsById[fromConversationViewThreadId(state, viewThreadId)]
              ?.modelId ?? "doubao-seed-2.1-turbo",
        })
        setStatus("Retry 已创建新的 assistant Message")
        return actionResult({
          assistantMessageId: result.command.assistantMessageId,
          sourceAssistantMessageId: assistantMessageId,
        })
      },
      async retryUserTurn(viewThreadId, userMessageId) {
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
            state.threadsById[threadId]?.modelId ?? "doubao-seed-2.1-turbo",
          text: textFromMessageParts(source.parts),
        })
        return actionResult({
          userMessageId: result.command.userMessageId,
          assistantMessageId: result.command.assistantMessageId,
          sourceUserMessageId: userMessageId,
          sourceAssistantMessageId: assistant?.id,
        })
      },
      async editAndRegenerate(viewThreadId, userMessageId, text) {
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
            state.threadsById[threadId]?.modelId ?? "doubao-seed-2.1-turbo",
          text,
        })
        setStatus("Edit 已追加新的 user/assistant，旧 turn 保留为 superseded")
        return actionResult({
          userMessageId: result.command.userMessageId,
          assistantMessageId: result.command.assistantMessageId,
          sourceUserMessageId: userMessageId,
          sourceAssistantMessageId: assistant?.id,
        })
      },
      async submitFeedback(viewThreadId, messageId, feedback) {
        const result = await runtime.commands.setFeedback(
          messageId,
          normalizedFeedback(feedback)
        )
        setStatus("反馈已通过 v1 command 更新")
        if (!feedback) return null
        return {
          treeId: projectId,
          threadId: fromConversationViewThreadId(state, viewThreadId),
          messageId,
          feedback,
          updatedAt: result.response.data.updatedAt,
        }
      },
    }),
    [projectId, runtime.commands, state]
  )

  const send = (viewThreadId: string, text: string) => {
    const threadId = fromConversationViewThreadId(state, viewThreadId)
    void runtime.commands
      .sendMessage({
        threadId,
        modelId:
          state.threadsById[threadId]?.modelId ?? "doubao-seed-2.1-turbo",
        text,
      })
      .then(({ connection }) => {
        setStatus(`${scenario}：命令已接受，等待终态`)
        void connection.finished.then(() =>
          setStatus(`${scenario}：终态已收敛`)
        )
      })
      .catch((error) => setStatus(`命令失败：${String(error)}`))
  }
  const stop = (viewThreadId: string) => {
    const threadId = fromConversationViewThreadId(state, viewThreadId)
    const active = [...selectVisibleMessages(state, threadId)]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" && message.status === "generating"
      )
    if (!active) return setStatus("当前会话没有生成任务")
    void runtime.commands
      .stopMessage(active.id)
      .then(() => setStatus("Stop 已登记；终态由流或轮询收敛"))
  }
  const retry = (viewThreadId: string, message: Message) => {
    void messageCommands.retryAssistant(viewThreadId, message.id)
  }
  const setModel = (viewThreadId: string, modelId: string) => {
    const threadId = fromConversationViewThreadId(state, viewThreadId)
    void runtime.commands.updateThread(threadId, { modelId })
  }

  const canvasStore = useMemo(() => {
    return createProjectedCanvasStore(runtime.store, runtime.commands)
  }, [runtime])
  useEffect(() => () => canvasStore.dispose(), [canvasStore])

  const canvasChat: CanvasChatActions = {
    send,
    stop,
    retry(viewThreadId, messageId) {
      void messageCommands.retryAssistant(viewThreadId, messageId)
    },
    ...messageCommands,
  }

  const handleFork = (
    info: SelectionInfo,
    _hint?: unknown,
    question?: string
  ) => {
    const parentThreadId = fromConversationViewThreadId(state, info.threadId)
    void runtime.commands
      .forkThread({
        parentThreadId,
        sourceMessageId: info.msgId,
        anchorText: info.text,
        anchor: info.anchor,
        modelId:
          state.threadsById[parentThreadId]?.modelId ?? "doubao-seed-2.1-turbo",
        ...(question ? { text: question } : {}),
      })
      .then(({ command, connection }) => {
        openThread(command.threadId)
        setStatus(
          question ? "带问分支已创建" : "空分支已创建并保留 Composer 预填"
        )
        if (connection)
          void connection.finished.then(() => setStatus("分支首轮已完成"))
      })
      .catch((error) => setStatus(`Fork 失败：${String(error)}`))
  }

  const rootHasMessages = (tree.threads.main?.messages.length ?? 0) > 0
  const branchCount = Math.max(0, Object.keys(tree.threads).length - 1)
  const markdownCount = Object.values(tree.artifacts).filter(
    (artifact) => artifact.kind === "markdown"
  ).length
  const selectedScenarioLabel =
    SCENARIOS.find((entry) => entry.id === scenario)?.label ?? scenario

  return (
    <div className="tc" data-gate3-normalized-harness="true">
      <ThreadChatTopbar
        viewMode={viewMode}
        showHelp
        windowWidth={windowWidth}
        forceCols={forceCols}
        placementMode={placementMode}
        branchCount={branchCount}
        markdownCount={markdownCount}
        onNewConversation={() => window.location.reload()}
        onToggleTreeList={() =>
          setStatus("对话列表将在 Gate 4 接正式 Project list API")
        }
        onOpenHelp={() => setStatus("这是 Gate 3 normalized runtime 验收入口")}
        onShowColumns={() =>
          runtime.store.getState().setWorkspace({ view: "columns" })
        }
        onShowCanvas={() =>
          runtime.store.getState().setWorkspace({ view: "canvas" })
        }
        onForceCols={setForceCols}
        onPlacementModeChange={setPlacementMode}
        onToggleThreadTree={() => openThread(GATE3_HARNESS_IDS.nestedThreadId)}
        onToggleMarkdown={() => setDrawerOpen((open) => !open)}
      />

      <aside
        data-gate3-controls="true"
        style={{
          position: "fixed",
          zIndex: 80,
          right: 12,
          top: 52,
          display: "grid",
          gap: 6,
          width: 230,
          padding: 10,
          border: "1px solid #d9d2c5",
          borderRadius: 10,
          background: "rgba(255, 253, 248, 0.96)",
          fontSize: 12,
          boxShadow: "0 8px 24px rgba(55, 48, 38, 0.12)",
        }}
      >
        <strong>Gate 3 · {selectedScenarioLabel}</strong>
        <select
          aria-label="测试场景"
          value={scenario}
          onChange={(event) => {
            const value = event.target.value as Gate3HarnessScenario
            setScenario(value)
            runtime.mock.setScenario(value)
            setStatus(`下一次发送使用：${value}`)
          }}
        >
          {SCENARIOS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <input
          aria-label="项目标题"
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
        />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              void runtime.commands
                .renameProject(projectId, titleDraft)
                .then(() => setStatus("Project/MainThread 标题已同步"))
            }}
          >
            重命名
          </button>
          <button
            onClick={() => {
              void runtime.commands
                .setProjectArchived(projectId, !state.project?.archivedAt)
                .then(() =>
                  setStatus(state.project?.archivedAt ? "已取消归档" : "已归档")
                )
            }}
          >
            {state.project?.archivedAt ? "取消归档" : "归档"}
          </button>
          <button
            onClick={() => {
              void runtime.commands
                .deleteProject(projectId)
                .then(() => setStatus("Project 已级联删除；刷新可重置 harness"))
            }}
          >
            删除
          </button>
        </div>
        <output aria-live="polite">{status}</output>
      </aside>

      {!state.project ? (
        <div className="boot-loading">
          Project 已删除，刷新页面可重置 harness。
        </div>
      ) : viewMode === "columns" ? (
        <ThreadColumns
          state={tree}
          slots={slots}
          widths={columnWidths}
          flashId={null}
          colsRef={columnsRef}
          onExpandStrip={openThread}
          onCommitWidths={(patch) =>
            setColumnWidths((current) => ({ ...current, ...patch }))
          }
          onResetWidths={(ids) =>
            setColumnWidths((current) =>
              Object.fromEntries(
                Object.entries(current).filter(([id]) => !ids.includes(id))
              )
            )
          }
          renderThread={(viewThreadId) => {
            const threadId = fromConversationViewThreadId(state, viewThreadId)
            const thread = tree.threads[viewThreadId]
            return (
              <BranchableChat
                state={tree}
                threadId={viewThreadId}
                subtitle={
                  viewThreadId === "main"
                    ? (state.project?.customTitle ??
                      state.project?.autoTitle ??
                      "新对话")
                    : undefined
                }
                onOpenThread={(target) => openThread(target)}
                onOpenArtifact={(artifactId) => {
                  setActiveArtifactId(artifactId)
                  setDrawerOpen(true)
                }}
                onCrumbNav={openThread}
                onOpenSwitcher={() =>
                  setStatus("Switcher 数据已由 normalized tree selector 提供")
                }
                onOpenSubtree={() => {
                  const child = thread?.children[0]
                  if (child) openThread(child)
                }}
                onCollapse={() =>
                  runtime.store.getState().setWorkspace({
                    openThreadIds: state.workspace.openThreadIds.filter(
                      (id) => id !== threadId
                    ),
                  })
                }
                busy={selectThreadBusy(state, threadId)}
                composerPrefill={
                  thread?.anchorText && thread.messages.length === 0
                    ? kickoffQuestion(thread.anchorText)
                    : undefined
                }
                onModelChange={(modelId) => setModel(viewThreadId, modelId)}
                onRetry={(message) => retry(viewThreadId, message)}
                onStop={() => stop(viewThreadId)}
                onSend={(text) => send(viewThreadId, text)}
                messageActionState={messageActionState}
                messageCommands={messageCommands}
              />
            )
          }}
        />
      ) : (
        <ThreadCanvas
          store={canvasStore}
          mainSubtitle={
            state.project?.customTitle ?? state.project?.autoTitle ?? undefined
          }
          viewState={canvasViewState}
          chat={canvasChat}
          messageActionState={messageActionState}
          onOpenThread={(threadId) => {
            runtime.store.getState().setWorkspace({ view: "columns" })
            openThread(threadId)
          }}
          onOpenArtifact={(artifactId) => {
            setActiveArtifactId(artifactId)
            setDrawerOpen(true)
          }}
        />
      )}

      <SelectionBubble
        state={tree}
        sel={selection}
        onSelChange={setSelection}
        onFork={handleFork}
        slots={slots}
        mode={placementMode}
        maxExpanded={Math.max(1, (forceCols ?? 3) - 1)}
        lastActiveOf={(threadId) => tree.threads[threadId]?.lastActive ?? 0}
      />
      <ArtifactDrawer
        state={tree}
        open={drawerOpen}
        activeId={activeArtifactId}
        onClose={() => setDrawerOpen(false)}
        onSelect={setActiveArtifactId}
        onLocate={(threadId) => {
          runtime.store.getState().setWorkspace({ view: "columns" })
          openThread(threadId)
        }}
      />
      {!rootHasMessages && state.project && (
        <div className="boot-loading">当前 Project 尚无消息。</div>
      )}
    </div>
  )
}
