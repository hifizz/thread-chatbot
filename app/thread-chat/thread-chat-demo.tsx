"use client"
/**
 * --------------------------------------------------------------------------
 * Thread Chat · 分支对话（方案⑥ 自适应列 + 列满策略：替换⑥ / 细条⑤）
 * --------------------------------------------------------------------------
 * 顶层壳：只负责状态编排与各层拼装，具体能力分四层实现——
 * · core/          headless 会话树 store + 选择器（useSyncExternalStore 绑定）；
 * · chat/          单会话视图（消息列表 + composer），不知道树/列/分支；
 * · branching/     把「分支能力」注入 chat：锚点/脚注/面包屑/继承上文/划选气泡；
 * · orchestration/ 视图编排：列视图（放置策略：替换⑥/细条⑤、切换器、Artifact 抽屉）
 *                  与画布视图（thread-canvas，React Flow 全树纵览，懒加载）两个平级视图层。
 *
 * 「打开某会话」的统一意图入口是 openBranchUI：脚注 / ⌘K / 每列 ⇄ / 子树弹层 /
 * Artifact 定位来源 / 画布双击节点全部走它——画布模式下先切回列视图（打开 = 去列里读），
 * 列满时按当前策略替换（可撤销）或折叠细条。
 *
 * 持久化（loader + inner 拆分）：默认导出 ThreadChatDemo 通过 useThreadChatBoot
 * 完成远端加载、strict-v2 清理与工作台恢复，随后才渲染 ThreadChatDemoInner
 * （store 以已存状态为种子一次性创建）。inner 订阅 store
 * version，useTreePersistence 防抖整树 PUT（流式高频跳变合并）+ 卸载 flush；
 * 工作台状态（列槽/列宽/列数/策略/视图）按 treeId 分键防抖写 localStorage。
 * --------------------------------------------------------------------------
 */

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import React, { useState } from "react"
import "./thread-chat.css"
import { activePathArtifacts } from "./core/selectors"
import type {
  Message,
  MessageFeedbackSummary,
  ThreadTreeState,
} from "./core/types"
import { deriveTreeTitle, type TreeUiState } from "./net/persistence/persist"
import type { GenerationSummary } from "./generation/types"
import type { RecoverableTurn } from "./generation/types"
import { useThreadChatBoot } from "./net/boot/use-thread-chat-boot"
import { BranchableChat } from "./branching/branchable-chat"
import { SelectionBubble } from "./branching/selection/selection-bubble"
import { type Slot } from "./orchestration/columns/placement"
import { ThreadColumns } from "./orchestration/columns/thread-columns"
import { ThreadSwitcher } from "./orchestration/navigation/thread-switcher"
import { TreeList } from "./orchestration/navigation/tree-list"
import { ArtifactDrawer } from "./orchestration/artifacts/artifact-drawer"
import { HelpPanel, UsageHint } from "./orchestration/overlays/help-panel"
import { ThreadChatTopbar } from "./orchestration/navigation/thread-chat-topbar"
import { useWorkspaceOverlays } from "./orchestration/overlays/use-workspace-overlays"
import {
  useWorkspaceToast,
  WorkspaceToast,
} from "./orchestration/overlays/workspace-toast"
import { useThreadChatRuntime } from "./orchestration/workspace/use-thread-chat-runtime"
import { useThreadChatWorkspace } from "./orchestration/workspace/use-thread-chat-workspace"
import { createBranchWorkspaceActions } from "./orchestration/workspace/branch-workspace-actions"

/** 画布视图层懒加载：React Flow 只在首次进入画布模式时才落地（且跳过 SSR） */
const ThreadCanvas = dynamic(
  () =>
    import("./orchestration/canvas/thread-canvas").then((m) => m.ThreadCanvas),
  {
    ssr: false,
    loading: () => <div className="canvas-loading">画布加载中…</div>,
  }
)

/** 主线列头副标题的兜底：整棵树还没有任何用户消息（也没被重命名）时展示 */
const SUBTITLE_FALLBACK = "新对话"

/** 画布模式喂给划选气泡的空列槽（稳定引用）：画布 fork 不占列槽（D4），
    气泡据此不渲染迷你列条（hasMap=false），提交路径由 handleFork 按视图分流 */
const EMPTY_SLOTS: Slot[] = []

/**
 * 默认导出的 loader：先完成远端加载（GET → sanitize → 读工作台记忆）再渲染 inner。
 * 加载失败 / 未命中都以空树降级（loadTree 内部已 console.warn），不阻塞页面。
 * treeId 变化由上层路由的 key={treeId} 整体重挂，不在此处处理切树。
 */
export function ThreadChatDemo({ treeId }: { treeId: string }) {
  const boot = useThreadChatBoot(treeId)

  if (!boot) {
    return (
      <div className="tc">
        <div className="boot-loading">对话加载中…</div>
      </div>
    )
  }
  return (
    <ThreadChatDemoInner
      treeId={treeId}
      initialState={boot.seed}
      initialUi={boot.ui}
      initialCustomTitle={boot.customTitle}
      initialGenerations={boot.generations}
      initialMessageFeedbacks={boot.messageFeedbacks}
      initialRecoverableTurns={boot.recoverableTurns}
    />
  )
}

interface ThreadChatDemoInnerProps {
  treeId: string
  /** store 种子：已 sanitize 的持久化状态，或空树 */
  initialState: ThreadTreeState
  /** 该树的工作台记忆（loader 已校验），null = 默认布局（只开主线） */
  initialUi: TreeUiState | null
  /** 用户重命名过的标题（未改过为 null）——主线列头副标题优先展示 */
  initialCustomTitle?: string | null
  initialGenerations: GenerationSummary[]
  initialMessageFeedbacks: MessageFeedbackSummary[]
  initialRecoverableTurns: RecoverableTurn[]
}

export function ThreadChatDemoInner({
  treeId,
  initialState,
  initialUi,
  initialCustomTitle = null,
  initialGenerations,
  initialMessageFeedbacks,
  initialRecoverableTurns,
}: ThreadChatDemoInnerProps) {
  const router = useRouter()

  const { toast, showToast, dismissToast } = useWorkspaceToast()
  const {
    store,
    state,
    chat,
    messageActionState,
    messageCommands,
    setTreeSaveSuppressed,
    isTreeSaveSuppressed,
  } = useThreadChatRuntime({
    treeId,
    initialState,
    initialGenerations,
    initialMessageFeedbacks,
    initialRecoverableTurns,
    onToast: showToast,
  })

  const {
    windowWidth: winW,
    forceCols,
    setForceCols,
    maxExpanded,
    mode,
    setMode,
    columns: cols,
    viewMode,
    setViewMode,
    focusNode,
    focusCanvasNode,
    showColumnsView,
    canvasChat,
    canvasViewState,
  } = useThreadChatWorkspace({
    treeId,
    store,
    chat,
    messageCommands,
    initialUi,
    isSaveSuppressed: isTreeSaveSuppressed,
  })

  /* ---------- 主线列头副标题：customTitle（用户重命名）→ 自动标题 / 派生回退 → 兜底 ----------
       customTitle 本地态由对话列表的 onRenamedCurrent 同步（重命名当前树立即生效，无需重载） */
  const [customTitle, setCustomTitle] = useState<string | null>(
    initialCustomTitle
  )
  const mainHasMessage = (state.threads.main?.messages.length ?? 0) > 0
  const mainSubtitle =
    customTitle ?? (mainHasMessage ? deriveTreeTitle(state) : SUBTITLE_FALLBACK)

  /* ---------- 其余 UI 状态 ---------- */
  /* 首次内联提示：仅「未关过 && 还没开始聊」时可见；顶栏帮助另走 Dialog。 */
  const [hintDismissed, setHintDismissed] = useState(false)
  const {
    rootRef: tcRootRef,
    selection: sel,
    setSelection: setSel,
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
    activeArtifactId: activeArt,
    setActiveArtifactId: setActiveArt,
    openArtifact,
    toggleDrawer,
    closeDrawer,
  } = useWorkspaceOverlays()

  const {
    openBranchUI,
    handleFork,
    changeMode,
    pickRow,
    isThreadBusy,
    composerPrefillFor,
  } = createBranchWorkspaceActions({
    state,
    store,
    chat,
    columns: cols,
    viewMode,
    mode,
    setMode,
    showColumnsView,
    focusCanvasNode,
    closeSwitcher,
    showToast,
  })

  /* ---------- 主线 hint 卡片：仅整棵树还没有任何消息时展示（判 main 即可——
       分支必经主线产生），首条消息一出现即随派生状态消失；× 可提前手动关。 ---------- */
  const hintVisible = !hintDismissed && !mainHasMessage
  const hintNode = hintVisible ? (
    <UsageHint onDismiss={() => setHintDismissed(true)} />
  ) : null

  /* ---------- 顶栏数据 ---------- */
  const branchCount = Object.keys(state.threads).length - 1
  const markdownCount = activePathArtifacts(state).reduce(
    (count, artifact) => count + (artifact.kind === "markdown" ? 1 : 0),
    0
  )

  return (
    <div className="tc" ref={tcRootRef}>
      <ThreadChatTopbar
        viewMode={viewMode}
        showHelp={viewMode === "canvas" || !hintVisible}
        windowWidth={winW}
        forceCols={forceCols}
        placementMode={mode}
        branchCount={branchCount}
        markdownCount={markdownCount}
        onNewConversation={() => {
          // 空树已经是新对话；反复点击不应让 URL 持续变化。
          if (!mainHasMessage) {
            showToast("当前就是全新对话，直接开聊吧")
            return
          }
          router.push(`/thread-chat/${crypto.randomUUID()}`)
        }}
        onToggleTreeList={toggleTreeList}
        onOpenHelp={openHelpPanel}
        onShowColumns={showColumnsView}
        onShowCanvas={() => setViewMode("canvas")}
        onForceCols={setForceCols}
        onPlacementModeChange={changeMode}
        onToggleThreadTree={toggleGlobalSwitcher}
        onToggleMarkdown={toggleDrawer}
      />

      {viewMode === "columns" ? (
        <ThreadColumns
          state={state}
          slots={cols.slots}
          widths={cols.widths}
          flashId={cols.flashId}
          colsRef={cols.colsRef}
          onExpandStrip={(id) => openBranchUI(id, null)}
          onCommitWidths={cols.commitWidths}
          onResetWidths={cols.resetWidths}
          renderThread={(threadId, vpIndex) => (
            <BranchableChat
              state={state}
              threadId={threadId}
              subtitle={threadId === "main" ? mainSubtitle : undefined}
              intro={threadId === "main" ? hintNode : undefined}
              onOpenThread={(target, opts) =>
                openBranchUI(target, threadId, opts)
              }
              onOpenArtifact={openArtifact}
              onCrumbNav={(target) =>
                cols.navColumn(vpIndex, target, "collapse")
              }
              onOpenSwitcher={(btn) => openColumnSwitcher(vpIndex, btn)}
              onOpenSubtree={(btn) => openSubtree(threadId, btn)}
              onCollapse={() => cols.closeColumn(vpIndex)}
              busy={isThreadBusy(threadId)}
              composerPrefill={composerPrefillFor(threadId)}
              onModelChange={(modelId) =>
                store.setThreadModel(threadId, modelId)
              }
              onRetry={(msg: Message) => chat.retry(threadId, msg.id)}
              onStop={() => chat.stop(threadId)}
              onSend={(text) => chat.send(threadId, text)}
              messageActionState={messageActionState}
              messageCommands={messageCommands}
            />
          )}
        />
      ) : (
        <ThreadCanvas
          store={store}
          mainSubtitle={mainSubtitle}
          viewState={canvasViewState}
          chat={canvasChat}
          messageActionState={messageActionState}
          focusNode={focusNode}
          onOpenThread={(id) => openBranchUI(id, null)}
          onOpenArtifact={openArtifact}
        />
      )}

      {/* 划选气泡两种视图都在（画布面板消息与列模式同一套 .md-body 划选 DOM 契约，
          openspec: add-canvas-conversations）。列模式：列槽上下文喂迷你列条，预览与
          提交共用 placement 规则；画布模式：喂空槽（不渲染列条，fork 不占列槽 D4）。 */}
      <SelectionBubble
        state={state}
        sel={sel}
        onSelChange={setSel}
        onFork={handleFork}
        slots={viewMode === "canvas" ? EMPTY_SLOTS : cols.slots}
        mode={mode}
        maxExpanded={maxExpanded}
        lastActiveOf={(id) => state.threads[id]?.lastActive ?? 0}
      />

      {treeList !== null && (
        <TreeList
          key={treeList.n}
          currentTreeId={treeId}
          currentTitle={customTitle ?? deriveTreeTitle(state)}
          currentThreadCount={Object.keys(state.threads).length}
          closing={treeList.closing}
          container={tcRootRef}
          onClose={closeTreeList}
          onSwitch={(id) => router.push(`/thread-chat/${id}`)}
          onSuppressCurrentSave={(v) => {
            // 删除前置位（失败恢复）：挡住防抖回调与卸载 flush 的新写；
            // 已在飞的 PUT 由 persist 写链保证先于 DELETE 落库，两头闭环
            setTreeSaveSuppressed(v)
          }}
          onDeleteCurrent={(nextId) => {
            // 当前树已被删除：抑制卸载 flush / 防抖尾巴的回写（否则 DB 行复活），
            // 再跳剩余最近一棵；一棵不剩则开新 UUID。replace 不给被删 URL 留历史。
            setTreeSaveSuppressed(true)
            closeTreeList()
            router.replace(`/thread-chat/${nextId ?? crypto.randomUUID()}`)
          }}
          onRenamedCurrent={setCustomTitle}
          onToast={showToast}
        />
      )}

      {switcher && (
        <ThreadSwitcher
          key={switcher.n}
          state={state}
          mode={switcher}
          slots={cols.slots}
          recents={state.recents}
          closing={switcher.closing}
          container={tcRootRef}
          onPick={pickRow}
          onClose={closeSwitcher}
        />
      )}

      {helpPanel && (
        <HelpPanel
          key={helpPanel.n}
          closing={helpPanel.closing}
          container={tcRootRef}
          onClose={closeHelpPanel}
        />
      )}

      <ArtifactDrawer
        state={state}
        open={drawerOpen}
        activeId={activeArt}
        onClose={closeDrawer}
        onSelect={setActiveArt}
        onLocate={(threadId, sourceMessageId) => {
          const sourceThread = state.threads[threadId]
          if (
            sourceThread &&
            sourceThread.activeLeafMessageId !== sourceMessageId
          )
            void chat
              .switchTurnVariant(threadId, sourceMessageId)
              .then((result) => {
                if (result.ok) openBranchUI(threadId, null)
              })
          else openBranchUI(threadId, null)
        }}
      />

      <WorkspaceToast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
