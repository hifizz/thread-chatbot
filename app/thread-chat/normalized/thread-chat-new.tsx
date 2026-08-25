"use client"

import dynamic from "next/dynamic"
import { useMemo, useRef, useState } from "react"
import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/model"
import {
  useNewProjectDraftStore,
  useSubmitNewProjectDraft,
} from "@/lib/thread-chat/client/hooks"
import { emptySeedState } from "../core/seed"
import { createThreadStore } from "../core/store"
import { ThreadColumns } from "../orchestration/columns/thread-columns"
import { BranchableChat } from "../branching/branchable-chat"
import { ThreadChatTopbar } from "../orchestration/navigation/thread-chat-topbar"
import { useColumnViewport } from "../orchestration/columns/use-column-viewport"
import { useWorkspaceOverlays } from "../orchestration/overlays/use-workspace-overlays"
import { HelpPanel, UsageHint } from "../orchestration/overlays/help-panel"
import {
  useWorkspaceToast,
  WorkspaceToast,
} from "../orchestration/overlays/workspace-toast"
import { ArtifactDrawer } from "../orchestration/artifacts/artifact-drawer"
import { ProjectList } from "./project-list"

const NEW_PROJECT_VIEW = emptySeedState()
const EMPTY_ACTION_VIEW = {
  recoverableByUserMessageId: new Map(),
  feedbackByMessageId: new Map(),
  activePathByThreadId: new Map(),
  presentationByThreadId: new Map(),
}

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

export function ThreadChatNew() {
  const submit = useSubmitNewProjectDraft()
  const status = useNewProjectDraftStore((state) => state.status)
  const error = useNewProjectDraftStore((state) => state.error)
  const setDraftParts = useNewProjectDraftStore(
    (state) => state.setDraftParts
  )
  const setRequestedModelId = useNewProjectDraftStore(
    (state) => state.setRequestedModelId
  )
  const [modelId, setModelId] = useState<string>(
    DEFAULT_THREAD_CHAT_MODEL_ID
  )
  const [hintDismissed, setHintDismissed] = useState(false)
  const [viewMode, setViewMode] = useState<"columns" | "canvas">("columns")
  const [forceCols, setForceCols] = useState<number | null>(null)
  const [placementMode, setPlacementMode] = useState<"replace" | "fold">(
    "replace"
  )
  const [canvasStore] = useState(() => createThreadStore(emptySeedState()))
  const canvasViewState = useMemo(() => ({ pins: new Map() }), [])
  const { windowWidth } = useColumnViewport()
  const {
    rootRef,
    treeList,
    closeTreeList,
    toggleTreeList,
    helpPanel,
    closeHelpPanel,
    openHelpPanel,
    drawerOpen,
    toggleGlobalSwitcher,
    toggleDrawer,
    closeDrawer,
  } = useWorkspaceOverlays()
  const colsRef = useRef<HTMLDivElement | null>(null)
  const { toast, showToast, dismissToast } = useWorkspaceToast()
  const hint = !hintDismissed ? (
    <UsageHint onDismiss={() => setHintDismissed(true)} />
  ) : null

  const create = (text: string) => {
    setDraftParts([{ type: "text", text }])
    setRequestedModelId(modelId)
    void submit()
  }

  return (
    <div className="tc" ref={rootRef}>
      <ThreadChatTopbar
        viewMode={viewMode}
        showHelp={viewMode === "canvas" || hintDismissed}
        windowWidth={windowWidth}
        forceCols={forceCols}
        placementMode={placementMode}
        branchCount={0}
        markdownCount={0}
        onNewConversation={() => showToast("当前就是全新对话，直接开聊吧")}
        onToggleTreeList={toggleTreeList}
        onOpenHelp={openHelpPanel}
        onShowColumns={() => setViewMode("columns")}
        onShowCanvas={() => setViewMode("canvas")}
        onForceCols={setForceCols}
        onPlacementModeChange={setPlacementMode}
        onToggleThreadTree={toggleGlobalSwitcher}
        onToggleMarkdown={toggleDrawer}
      />
      {viewMode === "columns" ? (
        <ThreadColumns
          state={NEW_PROJECT_VIEW}
          slots={[]}
          widths={{}}
          flashId={null}
          colsRef={colsRef}
          renderThread={() => (
            <BranchableChat
              state={NEW_PROJECT_VIEW}
              threadId="main"
              subtitle="新对话"
              intro={hint}
              onOpenThread={() => undefined}
              onOpenArtifact={() => undefined}
              onCrumbNav={() => undefined}
              onOpenSwitcher={() => undefined}
              onOpenSubtree={() => undefined}
              onCollapse={() => undefined}
              busy={status === "submitting"}
              onStop={() => undefined}
              onModelChange={setModelId}
              onSend={create}
            />
          )}
          onExpandStrip={() => undefined}
          onCommitWidths={() => undefined}
          onResetWidths={() => undefined}
        />
      ) : (
        <ThreadCanvas
          store={canvasStore}
          mainSubtitle="新对话"
          viewState={canvasViewState}
          onOpenThread={() => setViewMode("columns")}
          onOpenArtifact={() => undefined}
          chat={{
            send: (_threadId, text) => create(text),
            stop: () => undefined,
            retry: () => undefined,
            retryAssistant: async () => ({
              ok: false,
              code: "invalid_turn",
              message: "还没有可重试的回复",
            }),
            retryUserTurn: async () => ({
              ok: false,
              code: "invalid_turn",
              message: "还没有可重试的提问",
            }),
            editAndRegenerate: async () => ({
              ok: false,
              code: "invalid_turn",
              message: "还没有可编辑的提问",
            }),
            switchTurnVariant: async () => ({
              ok: false,
              code: "invalid_turn",
              message: "还没有可切换的回复",
            }),
            submitFeedback: async () => null,
          }}
          messageActionState={EMPTY_ACTION_VIEW}
        />
      )}
      {error && (
        <div className="workspace-toast" role="alert">
          {error.message}
        </div>
      )}
      {treeList && (
        <ProjectList
          key={treeList.n}
          currentProjectId={null}
          closing={treeList.closing}
          container={rootRef}
          onClose={closeTreeList}
          onToast={showToast}
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
        state={NEW_PROJECT_VIEW}
        open={drawerOpen}
        activeId={null}
        onClose={closeDrawer}
        onSelect={() => undefined}
        onLocate={() => undefined}
      />
      <WorkspaceToast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
