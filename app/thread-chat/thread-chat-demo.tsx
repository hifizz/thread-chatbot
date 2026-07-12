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
 * --------------------------------------------------------------------------
 */

import Link from "next/link"
import dynamic from "next/dynamic"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  Columns3,
  Highlighter,
  Network,
  PanelRightOpen,
  Waypoints,
} from "lucide-react"
import "./thread-chat.css"
import { emptySeedState } from "./core/seed"
import { createThreadStore } from "./core/store"
import { useThreadStore } from "./core/use-thread-store"
import { threadTitle, type TreeRow } from "./core/selectors"
import type { Message } from "./core/types"
import { createChatController } from "./net/chat-controller"
import { kickoffQuestion } from "./net/prompt"
import { BranchableChat } from "./branching/branchable-chat"
import {
  SelectionBubble,
  type SelectionInfo,
} from "./branching/selection-bubble"
import {
  type PlacementHint,
  type PlacementMode,
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
import { ArtifactDrawer } from "./orchestration/artifact-drawer"
import type { CanvasViewState } from "./orchestration/use-canvas-layout"

/** 画布视图层懒加载：React Flow 只在首次进入画布模式时才落地（且跳过 SSR） */
const ThreadCanvas = dynamic(
  () => import("./orchestration/thread-canvas").then((m) => m.ThreadCanvas),
  {
    ssr: false,
    loading: () => <div className="canvas-loading">画布加载中…</div>,
  }
)

type ViewMode = "columns" | "canvas"

const MAIN_SUBTITLE = "接入 MiniMax 的流式对话"

interface ToastState {
  msg: string
  undo?: () => void
  n: number
}

/** 把面板锚定在按钮下方（夹在视口内），w/h 为面板预估尺寸 */
function anchoredPos(btn: HTMLElement, w: number, h: number) {
  const rect = btn.getBoundingClientRect()
  const x = Math.max(8, Math.min(rect.right - w, window.innerWidth - (w + 8)))
  let y = rect.bottom + 6
  if (y + h > window.innerHeight) y = Math.max(8, window.innerHeight - (h + 10))
  return { x, y }
}

export function ThreadChatDemo() {
  /* ---------- 会话树：外部可变 store，version 快照驱动重渲 ---------- */
  const [store] = useState(() => createThreadStore(emptySeedState()))
  useThreadStore(store)
  const state = store.getState()

  /* ---------- 聊天控制器：发送 / 分支首答 / 重试 / 停止（真实 /api/chat SSE 流式） ---------- */
  const [chat] = useState(() => createChatController(store))
  useEffect(() => () => chat.abortAll(), [chat])

  /* ---------- 自适应列数（SSR 阶段 winW=null，顶栏显示「列数」占位） ---------- */
  const winW = useWindowWidth()
  const [forceCols, setForceCols] = useState<number | null>(null)
  const autoCols =
    winW === null ? 3 : Math.max(2, Math.min(4, Math.floor(winW / COL_MIN_W)))
  const totalCols = forceCols ?? autoCols
  const maxExpanded = totalCols - 1

  /* ---------- 列槽编排：放置策略（替换⑥ / 细条⑤）+ 槽位状态 ---------- */
  const [mode, setMode] = useState<PlacementMode>("replace")
  const cols = useColumnSlots({ store, maxExpanded, mode })

  /* ---------- 视图形态：列（深读）| 画布（纵览全树） ---------- */
  const [viewMode, setViewMode] = useState<ViewMode>("columns")
  /** 画布视图状态宿主（节点 pin 表）：跨「列 ⇄ 画布」切换存活，属视口状态不进 core store。
      与上面的 store 同一模式：useState(初始化函数) 造出的长寿可变对象（type-only import，
      不把画布模块拖进首屏 bundle） */
  const [canvasViewState] = useState<CanvasViewState>(() => ({
    pins: new Map(),
  }))

  /* ---------- 其余 UI 状态 ---------- */
  const [hintOn, setHintOn] = useState(true)
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  const [switcher, setSwitcher] = useState<
    (SwitcherMode & { n: number }) | null
  >(null)
  const swSeq = useRef(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeArt, setActiveArt] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)

  function showToast(msg: string, undo?: () => void) {
    setToast({ msg, undo, n: ++toastSeq.current })
  }
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.undo ? 5200 : 2600)
    return () => clearTimeout(t)
  }, [toast])

  /* ---------- 统一意图入口：打开某会话（脚注 / ⌘K / 子树 / 定位来源 / 画布双击都走这里）
       hint：可选放置提示（⌘ keepSource「保留来源列，开在其右」/ targetId 显式让位列） ---------- */
  function openBranchUI(
    id: string,
    sourceId?: string | null,
    hint?: PlacementHint
  ) {
    // 意图收敛：打开会话 = 去列里读它——画布模式下先切回列视图再放置
    setViewMode("columns")
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
       不自动发请求：新分支 composer 预填代拟问题，用户改写或回车确认后才走 chat.send ---------- */
  function handleFork(s: SelectionInfo, hint?: PlacementHint) {
    const r = store.fork({
      sourceThreadId: s.threadId,
      sourceMsgId: s.msgId,
      anchorText: s.text,
      // 划选处前后的源文本上下文：锚点在重复文字中的精确定位依据（采集失败时为 undefined）
      prefix: s.prefix,
      suffix: s.suffix,
    })
    if (!r) return
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

  /* ---------- 切换器 / 子树面板（互斥：同一时间只开一个；每次打开重挂归零） ---------- */
  const toggleGlobalSwitcher = useCallback(() => {
    const n = ++swSeq.current
    setSwitcher((sw) => (sw?.kind === "global" ? null : { kind: "global", n }))
  }, [])
  function openColumnSwitcher(vpIndex: number, btn: HTMLElement) {
    const { x, y } = anchoredPos(btn, 330, 420)
    setSwitcher({ kind: "column", vpIndex, x, y, n: ++swSeq.current })
  }
  function openSubtree(rootId: string, btn: HTMLElement) {
    const { x, y } = anchoredPos(btn, 340, 400)
    setSwitcher({ kind: "subtree", rootId, x, y, n: ++swSeq.current })
  }
  function pickRow(row: TreeRow, m: SwitcherMode) {
    setSwitcher(null)
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

  /* ---------- 快捷键：⌘K 会话树 / Esc 逐层关闭（气泡 → 面板 → 抽屉） ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        toggleGlobalSwitcher()
        return
      }
      if (e.key === "Escape") {
        if (sel) setSel(null)
        else if (switcher) setSwitcher(null)
        else if (drawerOpen) setDrawerOpen(false)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [sel, switcher, drawerOpen, toggleGlobalSwitcher])

  /** 会话是否忙碌：末条消息是 assistant 且仍在 pending/streaming（派生自 state，version 快照天然驱动） */
  function isThreadBusy(threadId: string): boolean {
    const msgs = state.threads[threadId]?.messages
    if (!msgs?.length) return false
    const last = msgs[msgs.length - 1]
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

  /* ---------- 主线 hint 卡片 ---------- */
  const hintNode = hintOn ? (
    <div className="hint">
      <Highlighter size={15} color="#b07d2e" />
      <div>
        <b>划选 AI 回复里的文字</b>即可开分支——新分支的输入框会
        <b>预填一条围绕划选内容的问题</b>
        ，可改写后回车确认提问。列数随屏宽自适应（2–4 列）。列满后继续深入默认
        <b>替换来源列</b>（提示条可撤销），顶栏切到<b>细条⑤</b>
        则改为把最久未用的列折成竖直细条。 按住 <span className="kbd">⌘</span>
        /Ctrl 划选开分支或点脚注 = <b>保留本列</b>
        、新会话开在紧邻右侧；气泡底部的迷你列条会预览将替换 /
        折叠哪一列，点小格可改选让位目标。
        <b>拖动列间分割线可调宽度，双击恢复均分</b>。面包屑可就地回退；按{" "}
        <span className="kbd">⌘K</span> 搜会话树，点列头 <b>⇄</b>{" "}
        把该列切换成任意会话，<b>⑂</b> 查看该会话的子分支。分支里产出的 Artifact
        会从右侧抽屉弹出。顶栏可切换<b>画布视图</b>
        ，纵览整棵会话树，双击节点回到列模式。
        当前为纯内存演示，刷新后对话不保留。
      </div>
      <span className="close" onClick={() => setHintOn(false)}>
        ✕
      </span>
    </div>
  ) : null

  /* ---------- 顶栏数据 ---------- */
  const branchCount = Object.keys(state.threads).length - 1
  const segLabel =
    winW === null
      ? "列数"
      : `列数 ${totalCols}${forceCols === null ? " · auto" : ""}`

  return (
    <div className="tc">
      <div className="topbar">
        <Link className="home" href="/" title="返回主聊天">
          ←
        </Link>
        <div className="brand">
          <span className="mark">
            Thread<em>·</em>
          </span>
          <span className="tag">方案⑥ 自适应列 + 面包屑替换 · 优化版</span>
        </div>
        <div className="spacer" />
        <div className="seg">
          <span className="lbl" title="列 = 并排深读；画布 = 纵览整棵会话树">
            视图
          </span>
          <button
            className={`mode ${viewMode === "columns" ? "on" : ""}`}
            title="列视图：并排深读多个会话"
            onClick={() => setViewMode("columns")}
          >
            <Columns3 size={12} />列
          </button>
          <button
            className={`mode ${viewMode === "canvas" ? "on" : ""}`}
            title="画布视图：纵览整棵会话树，双击节点回到列模式"
            onClick={() => setViewMode("canvas")}
          >
            <Waypoints size={12} />
            画布
          </button>
        </div>
        {viewMode === "columns" && (
          <>
            <div className="seg">
              <span
                className="lbl"
                title={
                  winW === null
                    ? undefined
                    : `视口 ${winW}px，约每 ${COL_MIN_W}px 一列`
                }
              >
                {segLabel}
              </span>
              {(["auto", 2, 3, 4] as const).map((v) => (
                <button
                  key={v}
                  className={
                    (v === "auto" ? forceCols === null : forceCols === v)
                      ? "on"
                      : ""
                  }
                  onClick={() => setForceCols(v === "auto" ? null : v)}
                >
                  {v === "auto" ? "自适应" : v}
                </button>
              ))}
            </div>
            <div className="seg">
              <span className="lbl" title="列满时的放置策略">
                列满
              </span>
              <button
                className={mode === "replace" ? "on" : ""}
                onClick={() => changeMode("replace")}
              >
                替换⑥
              </button>
              <button
                className={mode === "fold" ? "on" : ""}
                onClick={() => changeMode("fold")}
              >
                细条⑤
              </button>
            </div>
          </>
        )}
        <button
          className="tbtn"
          title="搜索并打开任意会话（⌘K）"
          onClick={toggleGlobalSwitcher}
        >
          <Network size={13} />
          会话树{branchCount > 0 ? ` · ${branchCount}` : ""}
          <span className="kbd">⌘K</span>
        </button>
        <button
          className="tbtn"
          title="打开 / 收起 Artifact 抽屉"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <PanelRightOpen size={13} />
          Artifact
          <span className="cnt">{state.artifactOrder.length}</span>
        </button>
        <span className="demo-pill">MiniMax</span>
      </div>

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
              subtitle={threadId === "main" ? MAIN_SUBTITLE : undefined}
              intro={threadId === "main" ? hintNode : undefined}
              onOpenThread={(target, opts) =>
                openBranchUI(target, threadId, opts)
              }
              onOpenArtifact={(aid) => {
                setActiveArt(aid)
                setDrawerOpen(true)
              }}
              onCrumbNav={(target) =>
                cols.navColumn(vpIndex, target, "collapse")
              }
              onOpenSwitcher={(btn) => openColumnSwitcher(vpIndex, btn)}
              onOpenSubtree={(btn) => openSubtree(threadId, btn)}
              onCollapse={() => cols.closeColumn(vpIndex)}
              busy={isThreadBusy(threadId)}
              composerPrefill={composerPrefillFor(threadId)}
              onRetry={(msg: Message) => chat.retry(threadId, msg.id)}
              onStop={() => chat.abort(threadId)}
              onSend={(text) => chat.send(threadId, text)}
            />
          )}
        />
      ) : (
        <ThreadCanvas
          store={store}
          mainSubtitle={MAIN_SUBTITLE}
          viewState={canvasViewState}
          onOpenThread={(id) => openBranchUI(id, null)}
        />
      )}

      {/* Phase 1 画布只读：划选开分支仅列模式提供。列槽上下文喂给气泡的迷你列条，
          预览与提交共用 placement 同一套规则 */}
      {viewMode === "columns" && (
        <SelectionBubble
          state={state}
          sel={sel}
          onSelChange={setSel}
          onFork={handleFork}
          slots={cols.slots}
          mode={mode}
          maxExpanded={maxExpanded}
          lastActiveOf={(id) => state.threads[id]?.lastActive ?? 0}
        />
      )}

      {switcher && (
        <ThreadSwitcher
          key={switcher.n}
          state={state}
          mode={switcher}
          slots={cols.slots}
          recents={state.recents}
          onPick={pickRow}
          onClose={() => setSwitcher(null)}
        />
      )}

      <ArtifactDrawer
        state={state}
        open={drawerOpen}
        activeId={activeArt}
        onClose={() => setDrawerOpen(false)}
        onSelect={setActiveArt}
        onLocate={(threadId) => openBranchUI(threadId, null)}
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
