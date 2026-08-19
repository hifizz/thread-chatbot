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
import React, { useCallback, useEffect, useRef, useState } from "react"
import "./thread-chat.css"
import { isThreadChatModelId } from "@/constants/model"
import { createThreadStore } from "./core/store"
import { useThreadStore } from "./core/use-thread-store"
import {
  activeLeafTurn,
  activePathArtifacts,
  threadTitle,
  type TreeRow,
} from "./core/selectors"
import type {
  Message,
  MessageFeedbackSummary,
  ThreadTreeState,
} from "./core/types"
import { createChatController } from "./net/chat-controller"
import { kickoffQuestion } from "./net/prompt"
import {
  deriveTreeTitle,
  saveTreeStrict,
  type TreeUiState,
  type ViewMode,
  TreeRevisionError,
} from "./net/persist"
import type { GenerationSummary } from "./generation/types"
import type { RecoverableTurn } from "./generation/types"
import { useGenerationReconciliation } from "./generation/use-generation-reconciliation"
import { useMessageActions } from "./chat/use-message-actions"
import { useTreePersistence } from "./net/use-tree-persistence"
import { useBranchTitles } from "./net/use-branch-titles"
import { useThreadChatBoot } from "./net/use-thread-chat-boot"
import { useUiStatePersistence } from "./orchestration/use-ui-state-persistence"
import { BranchableChat } from "./branching/branchable-chat"
import {
  SelectionBubble,
  type SelectionInfo,
} from "./branching/selection-bubble"
import {
  type PlacementHint,
  type PlacementMode,
  type Slot,
} from "./orchestration/placement"
import {
  COL_MIN_W,
  ThreadColumns,
  useColumnSlots,
  useWindowWidth,
} from "./orchestration/thread-columns"
import {
  ThreadSwitcher,
  type SwitcherMode,
} from "./orchestration/thread-switcher"
import { TreeList } from "./orchestration/tree-list"
import { ArtifactDrawer } from "./orchestration/artifact-drawer"
import { HelpPanel, UsageHint } from "./orchestration/help-panel"
import { ThreadChatTopbar } from "./orchestration/thread-chat-topbar"
import { useWorkspaceOverlays } from "./orchestration/use-workspace-overlays"
// type-only：不把画布模块（React Flow）拖进首屏 bundle
import type { CanvasChatActions } from "./orchestration/canvas-node"
import type { CanvasViewState } from "./orchestration/use-canvas-layout"

/** 画布视图层懒加载：React Flow 只在首次进入画布模式时才落地（且跳过 SSR） */
const ThreadCanvas = dynamic(
  () => import("./orchestration/thread-canvas").then((m) => m.ThreadCanvas),
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

interface ToastState {
  msg: string
  undo?: () => void
}

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

  /* ---------- 会话树：外部可变 store，version 快照驱动重渲 ---------- */
  const [store] = useState(() =>
    createThreadStore(initialState, isThreadChatModelId)
  )
  const version = useThreadStore(store)
  const state = store.getState()
  const [toast, setToast] = useState<ToastState | null>(null)

  function showToast(msg: string, undo?: () => void) {
    setToast({ msg, undo })
  }
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.undo ? 5200 : 2600)
    return () => clearTimeout(t)
  }, [toast])

  /* ---------- 聊天控制器：发送屏障 / Retry / 显式 Stop（真实 /api/chat SSE） ---------- */
  const [chat] = useState(() =>
    createChatController(store, {
      treeId,
      persistNow: () => {
        const current = store.getState()
        return saveTreeStrict(treeId, current, deriveTreeTitle(current)).catch(
          (error) => {
            if (error instanceof TreeRevisionError) {
              showToast("其他标签页已更新，正在重新加载…")
              window.location.reload()
            }
            throw error
          }
        )
      },
      onError: (message) => showToast(message),
    })
  )
  const {
    messageActionState,
    messageCommands,
    replacePersistedMessageActions,
  } = useMessageActions({
    state,
    version,
    initialRecoverableTurns,
    initialMessageFeedbacks,
    commands: chat,
  })
  useGenerationReconciliation({
    treeId,
    store,
    version,
    initialGenerations,
    replacePersistedMessageActions,
  })
  useEffect(() => () => chat.detachAll(), [chat])

  const { setTreeSaveSuppressed, isTreeSaveSuppressed } = useTreePersistence({
    treeId,
    store,
    version,
    onRevisionConflict: () => {
      showToast("其他标签页已更新，正在重新加载…")
      window.location.reload()
    },
  })
  useBranchTitles({ store, version })

  /* ---------- 自适应列数（SSR 阶段 winW=null，顶栏显示「列数」占位） ---------- */
  const winW = useWindowWidth()
  const [forceCols, setForceCols] = useState<number | null>(
    initialUi?.forceCols ?? null
  )
  const autoCols =
    winW === null ? 3 : Math.max(2, Math.min(4, Math.floor(winW / COL_MIN_W)))
  const totalCols = forceCols ?? autoCols
  const maxExpanded = totalCols - 1

  /* ---------- 列槽编排：放置策略（替换⑥ / 细条⑤）+ 槽位状态 ---------- */
  const [mode, setMode] = useState<PlacementMode>(initialUi?.mode ?? "replace")
  const cols = useColumnSlots({
    store,
    maxExpanded,
    mode,
    initialSlots: initialUi?.slots,
    initialWidths: initialUi?.widths,
  })

  /* ---------- 视图形态：列（深读）| 画布（纵览全树 + 节点内对话） ---------- */
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialUi?.viewMode ?? "columns"
  )
  /* 画布内 fork 的视口跟随指令（D4）：{id, n} 置值 → 画布 selectNode + setCenter。
     n 递增去重；属视口态不入档。 */
  const [focusNode, setFocusNode] = useState<{ id: string; n: number } | null>(
    null
  )
  const focusSeq = useRef(0)
  /** 切回列视图的统一出口：顺手清 focusNode——CanvasFlow 卸载会重置其去重 ref，
      残留指令会在下次进画布时误触发一次跟随动画 */
  const showColumnsView = useCallback(() => {
    setViewMode("columns")
    setFocusNode(null)
  }, [setViewMode, setFocusNode])
  /** 画布节点面板的会话动作（D3）：同一 chat-controller，无平行发送通道 */
  const [canvasChat] = useState<CanvasChatActions>(() => ({
    send: chat.send,
    stop: chat.stop,
    retry: chat.retry,
    retryAssistant: messageCommands.retryAssistant,
    retryUserTurn: messageCommands.retryUserTurn,
    editAndRegenerate: messageCommands.editAndRegenerate,
    switchTurnVariant: messageCommands.switchTurnVariant,
    submitFeedback: messageCommands.submitFeedback,
  }))

  useUiStatePersistence({
    treeId,
    slots: cols.slots,
    widths: cols.widths,
    forceCols,
    mode,
    viewMode,
    isSaveSuppressed: isTreeSaveSuppressed,
  })
  /** 画布视图状态宿主（节点 pin 表）：跨「列 ⇄ 画布」切换存活，属视口状态不进 core store。
      与上面的 store 同一模式：useState(初始化函数) 造出的长寿可变对象（type-only import，
      不把画布模块拖进首屏 bundle） */
  const [canvasViewState] = useState<CanvasViewState>(() => ({
    pins: new Map(),
  }))

  /* ---------- 主线列头副标题：customTitle（用户重命名）→ 派生标题（首条消息即更新）→ 兜底 ----------
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

  /* ---------- 统一意图入口：打开某会话（脚注 / ⌘K / 子树 / 定位来源 / 画布双击都走这里）
       hint：可选放置提示（⌘ keepSource「保留来源列，开在其右」/ targetId 显式让位列） ---------- */
  function openBranchUI(
    id: string,
    sourceId?: string | null,
    hint?: PlacementHint
  ) {
    // 意图收敛：打开会话 = 去列里读它——画布模式下先切回列视图再放置
    showColumnsView()
    if (id === "main") {
      cols.flashThread("main")
      return
    }
    const eff = cols.openThread(id, sourceId ?? null, hint)
    if (eff.kind === "replaced") {
      showToast(
        `第 ${eff.idx + 2} 列已替换：「${threadTitle(state, eff.replacedId)}」→「${threadTitle(state, id)}」`,
        () => {
          cols.restoreSlots(eff.prevSlots)
          cols.flashThread(eff.replacedId)
        }
      )
    } else if (eff.kind === "folded") {
      showToast(
        `已打开「${threadTitle(state, id)}」，「${threadTitle(state, eff.foldedId)}」已折叠为细条`
      )
    }
  }

  /* ---------- 开分支：store.fork + 放置（hint 来自气泡：⌘ / 列条点选）。
       留空路径不自动发请求：新分支 composer 预填代拟问题，用户改写或回车确认后才走 chat.send；
       带问路径（气泡输入框 question 非空）：fork + 放置后直接 chat.send——问题成为
       新分支第 1 条 user 消息并触发流式首答（D1：复用发送链路，store 无 firstQuestion 字段；
       消息一入树，composerPrefillFor 的「空分支才预填」条件即失效，两条路径互不串扰） ---------- */
  function handleFork(
    s: SelectionInfo,
    hint?: PlacementHint,
    question?: string
  ) {
    const r = store.fork({
      sourceThreadId: s.threadId,
      sourceMsgId: s.msgId,
      anchorText: s.text,
      // 文本锚点：渲染后 Markdown DOM 上的模糊恢复定位依据
      anchor: s.anchor,
    })
    if (!r) return
    const q = question?.trim()
    if (q) chat.send(r.threadId, q, { text: s.text }) // 划选原文随消息结构化落库（方向 C）
    // 画布内 fork（D4）：不占列槽——不走 cols.openThread（回列后布局与开分支前一致，
    // 新分支经脚注/⌘K 打开）；置 focusNode 让画布 selectNode + setCenter 平滑跟随
    if (viewMode === "canvas") {
      setFocusNode({ id: r.threadId, n: ++focusSeq.current })
      showToast(`已开启分支 · ${r.title}`)
      return
    }
    const eff = cols.openThread(r.threadId, s.threadId, hint)
    if (eff.kind === "replaced") {
      showToast(
        `已开启分支「${r.title}」，替换了第 ${eff.idx + 2} 列的「${threadTitle(state, eff.replacedId)}」`,
        () => {
          cols.restoreSlots(eff.prevSlots)
          cols.flashThread(eff.replacedId)
        }
      )
    } else if (eff.kind === "folded") {
      showToast(
        `已开启分支「${r.title}」，「${threadTitle(state, eff.foldedId)}」已折叠为细条`
      )
    } else {
      showToast(`已开启分支 · ${r.title}`)
    }
  }

  /* ---------- 列满策略切换（fold → replace 时展开全部细条并裁掉超限列） ---------- */
  function changeMode(m: PlacementMode) {
    if (m === mode) return
    setMode(m)
    if (m === "replace") {
      const dropped = cols.normalizeToReplace()
      if (dropped.length)
        showToast(
          `已切回替换⑥：细条全部展开后，超出列数的「${dropped.map((id) => threadTitle(state, id)).join("」「")}」已收起`
        )
    }
  }

  function pickRow(row: TreeRow, m: SwitcherMode) {
    closeSwitcher()
    if (m.kind === "column") {
      if (cols.slots[m.vpIndex]?.id === row.id) {
        cols.flashThread(row.id)
        return
      }
      cols.navColumn(m.vpIndex, row.id, "swap")
    } else if (m.kind === "subtree") {
      openBranchUI(row.id, m.rootId)
    } else {
      openBranchUI(row.id, null)
    }
  }

  /** 会话是否忙碌：末条消息是 assistant 且仍在 pending/streaming（派生自 state，version 快照天然驱动） */
  function isThreadBusy(threadId: string): boolean {
    const thread = state.threads[threadId]
    if (!thread) return false
    const last = activeLeafTurn(thread)?.assistantMessage
    if (!last) return false
    return (
      last.role === "assistant" &&
      (last.status === "pending" || last.status === "streaming")
    )
  }

  /** 分支 composer 的预填文案：仅「还没有任何消息的分支」预填代拟首问，待用户回车确认 */
  function composerPrefillFor(threadId: string): string | undefined {
    const t = state.threads[threadId]
    return t?.anchorText && t.messages.length === 0
      ? kickoffQuestion(t.anchorText)
      : undefined
  }

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

      <div className={`toast ${toast ? "show" : ""}`}>
        <span>{toast?.msg}</span>
        {toast?.undo && (
          <button
            className="undo"
            onClick={() => {
              toast.undo?.()
              setToast(null)
            }}
          >
            撤销
          </button>
        )}
      </div>
    </div>
  )
}
