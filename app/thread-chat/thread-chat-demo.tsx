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
 * 持久化（loader + inner 拆分）：默认导出 ThreadChatDemo 是 loader——挂载后
 * loadTree(treeId) → sanitize → 读工作台记忆，加载完才渲染 ThreadChatDemoInner
 * （store 以已存状态为种子一次性创建，内部编排逻辑零改动）。inner 里订阅 store
 * version，防抖 1.5s 整树 PUT（流式高频跳变合并为结束后一次写）+ 卸载 flush；
 * 工作台状态（列槽/列宽/列数/策略/视图）按 treeId 分键防抖写 localStorage。
 * --------------------------------------------------------------------------
 */

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  CircleHelp,
  Columns3,
  Highlighter,
  ListTodo,
  Network,
  Package,
  Waypoints,
} from "lucide-react"
import "./thread-chat.css"
import {
  POPUP_EXIT_MS,
  TREE_SAVE_DEBOUNCE_MS,
  UI_SAVE_DEBOUNCE_MS,
} from "@/constants/thread-chat"
import { emptySeedState } from "./core/seed"
import { createThreadStore, defaultBranchTitle } from "./core/store"
import { useThreadStore } from "./core/use-thread-store"
import { threadTitle, type TreeRow } from "./core/selectors"
import type { Message, ThreadTreeState } from "./core/types"
import { requestBranchTitle } from "./net/branch-title"
import { createChatController } from "./net/chat-controller"
import { kickoffQuestion } from "./net/prompt"
import {
  deriveTreeTitle,
  loadTree,
  loadUiState,
  rememberTreeId,
  sanitizeLoadedState,
  saveTree,
  saveUiState,
  type TreeUiState,
  type ViewMode,
} from "./net/persist"
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
import { TreeList } from "./orchestration/tree-list"
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

/** 主线列头副标题的兜底：整棵树还没有任何用户消息（也没被重命名）时展示 */
const SUBTITLE_FALLBACK = "新对话"

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

/**
 * 默认导出的 loader：先完成远端加载（GET → sanitize → 读工作台记忆）再渲染 inner。
 * 加载失败 / 未命中都以空树降级（loadTree 内部已 console.warn），不阻塞页面。
 * treeId 变化由上层路由的 key={treeId} 整体重挂，不在此处处理切树。
 */
export function ThreadChatDemo({ treeId }: { treeId: string }) {
  const [boot, setBoot] = useState<{
    seed: ThreadTreeState
    ui: TreeUiState | null
    /** 用户重命名过的标题（未改过为 null）——主线列头副标题优先展示 */
    customTitle: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await loadTree(treeId)
      // sanitize：收敛流式中途落盘的非终态 assistant 残留（见 persist.ts 头注）
      const seed = loaded.state
        ? sanitizeLoadedState(loaded.state)
        : emptySeedState()
      // 工作台记忆按加载回来的树校验（列引用的 thread 必须存在）
      const ui = loadUiState(treeId, seed)
      if (cancelled) return
      rememberTreeId(treeId) // 成功打开即记为「最近一棵」（裸路径的跳转目标）
      setBoot({ seed, ui, customTitle: loaded.customTitle })
    })()
    return () => {
      cancelled = true
    }
  }, [treeId])

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
}

export function ThreadChatDemoInner({
  treeId,
  initialState,
  initialUi,
  initialCustomTitle = null,
}: ThreadChatDemoInnerProps) {
  const router = useRouter()

  /* ---------- 会话树：外部可变 store，version 快照驱动重渲 ---------- */
  const [store] = useState(() => createThreadStore(initialState))
  const version = useThreadStore(store)
  const state = store.getState()

  /* ---------- 聊天控制器：发送 / 分支首答 / 重试 / 停止（真实 /api/chat SSE 流式） ---------- */
  const [chat] = useState(() => createChatController(store))
  useEffect(() => () => chat.abortAll(), [chat])

  /* ---------- 防抖存库：version 变化后 1.5s 静默才整树 PUT（流式期间合并为一次写）。
       首屏（version 未变过）不写；卸载时若有 pending 定时器则立即 flush（尽力而为）。
       suppressSaveRef：当前树被用户从列表里删除后置真——否则跳转离开时的卸载 flush
       / 防抖窗口尾巴会把刚删的 DB 行原样复活（工作台 localStorage 同理）。 ---------- */
  const initialVersionRef = useRef(version)
  const savePendingRef = useRef(false)
  const suppressSaveRef = useRef(false)
  useEffect(() => {
    if (version === initialVersionRef.current) return
    savePendingRef.current = true
    const t = setTimeout(() => {
      savePendingRef.current = false
      if (suppressSaveRef.current) return
      const s = store.getState()
      void saveTree(treeId, s, deriveTreeTitle(s))
    }, TREE_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [version, treeId, store])
  useEffect(
    () => () => {
      // 仅卸载时执行：防抖窗口内未落盘的变更立即补一次写
      if (savePendingRef.current && !suppressSaveRef.current) {
        savePendingRef.current = false
        const s = store.getState()
        void saveTree(treeId, s, deriveTreeTitle(s))
      }
    },
    [treeId, store]
  )

  /* ---------- 异步分支标题（D7）：分支首答完成后请求一次 4–8 字语义标题。
       触发条件：非主线、标题仍是默认（锚点截 13 字——已生成过 / 重命名过则跳过，
       重载后靠这一条天然防重）、首条 user + 首条 done 且非空的 assistant 都已就位。
       Set ref 防同会话内重复请求；成功走 setThreadTitle（随整树防抖存盘持久化），
       失败 console.warn 静默保留默认标题。 ---------- */
  const titleReqRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const s = store.getState()
    for (const t of Object.values(s.threads)) {
      if (!t.parentId || !t.anchorText) continue
      if (titleReqRef.current.has(t.id)) continue
      if (t.title !== defaultBranchTitle(t.anchorText)) continue
      const q = t.messages.find((m) => m.role === "user")
      const a = t.messages.find(
        (m) =>
          m.role === "assistant" && m.status === "done" && m.text.trim() !== ""
      )
      if (!q || !a) continue
      titleReqRef.current.add(t.id)
      const threadId = t.id
      void requestBranchTitle({
        anchorText: t.anchorText,
        question: q.text,
        answer: a.text,
      })
        .then((title) => {
          if (title) store.setThreadTitle(threadId, title)
        })
        .catch((err) => {
          console.warn("[thread-chat] 分支标题生成失败（保留默认标题）：", err)
        })
    }
  }, [version, store])

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

  /* ---------- 视图形态：列（深读）| 画布（纵览全树） ---------- */
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialUi?.viewMode ?? "columns"
  )

  /* ---------- 工作台状态记忆（D7）：五项变化 ~300ms 轻防抖写 localStorage（按 treeId 分键）。
       首帧也会写一次，但内容 == 恢复出的初值，幂等无伤。 ---------- */
  useEffect(() => {
    const t = setTimeout(() => {
      if (suppressSaveRef.current) return // 树已被删除：别把刚清掉的工作台记忆写回去
      saveUiState(treeId, {
        slots: cols.slots,
        widths: cols.widths,
        forceCols,
        mode,
        viewMode,
      })
    }, UI_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [treeId, cols.slots, cols.widths, forceCols, mode, viewMode])
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
  /* hint 双态：dismissed = 用户 × 关过；manual = 经顶栏「帮助」重开（开聊后也能看）。
     可见性纯派生：手动打开恒可见；否则仅「未关过 && 还没开始聊」时可见。 */
  const [hintDismissed, setHintDismissed] = useState(false)
  const [hintManual, setHintManual] = useState(false)
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  /** closing = 正在播放退场动画（Dialog 置 open=false / local 面板加 .closing），
      到点（POPUP_EXIT_MS）由下方 effect 真正卸载 */
  const [switcher, setSwitcher] = useState<
    (SwitcherMode & { n: number; closing?: boolean }) | null
  >(null)
  const swSeq = useRef(0)
  /** 会话列表弹层：非 null = 打开（n 为重挂 key，每次打开归零内部状态并现拉数据） */
  const [treeList, setTreeList] = useState<{
    n: number
    closing?: boolean
  } | null>(null)
  const tlSeq = useRef(0)
  /** .tc 根元素：两个 Dialog 弹层的 Portal 挂载点（保住 .tc 作用域的选择器与 CSS 变量） */
  const tcRootRef = useRef<HTMLDivElement | null>(null)
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
    if (q) chat.send(r.threadId, q)
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

  /* ---------- 切换器 / 子树面板（互斥：同一时间只开一个；每次打开重挂归零）
       关闭不再直接卸载：先置 closing 播放退场动画，POPUP_EXIT_MS 后由 effect 卸载。
       重开会换成新对象（closing 归零），旧计时器被 effect cleanup 自动清掉。 ---------- */
  const closeSwitcher = useCallback(() => {
    setSwitcher((sw) => (sw && !sw.closing ? { ...sw, closing: true } : sw))
  }, [])
  const closeTreeList = useCallback(() => {
    setTreeList((v) => (v && !v.closing ? { ...v, closing: true } : v))
  }, [])
  useEffect(() => {
    if (!switcher?.closing) return
    const t = setTimeout(() => setSwitcher(null), POPUP_EXIT_MS)
    return () => clearTimeout(t)
  }, [switcher])
  useEffect(() => {
    if (!treeList?.closing) return
    const t = setTimeout(() => setTreeList(null), POPUP_EXIT_MS)
    return () => clearTimeout(t)
  }, [treeList])

  const toggleGlobalSwitcher = useCallback(() => {
    setSwitcher((sw) =>
      // 全局面板开着 → 动画关闭；关着 / 关闭中 / 开的是局部面板 → （重新）打开全局
      sw?.kind === "global" && !sw.closing
        ? { ...sw, closing: true }
        : { kind: "global", n: ++swSeq.current }
    )
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

  const toggleTreeList = useCallback(() => {
    setTreeList((v) =>
      v && !v.closing ? { ...v, closing: true } : { n: ++tlSeq.current }
    )
  }, [])

  /* ---------- 快捷键：⌘⇧K 对话列表 / ⌘K 会话树 / Esc 逐层关闭
       （对话列表弹层在关闭链最外层：列表 → 气泡 → 面板 → 抽屉） ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        if (e.shiftKey) toggleTreeList()
        else toggleGlobalSwitcher()
        return
      }
      if (e.key === "Escape") {
        // 逐层关闭链的唯一权威：Dialog 内建的 Esc 关闭已在 dialogCloseToShell 里
        // 取消并放行冒泡，事件最终只在这里被消费（closing 中的弹层视同已关闭）
        if (treeList && !treeList.closing) closeTreeList()
        else if (sel) setSel(null)
        else if (switcher && !switcher.closing) closeSwitcher()
        else if (drawerOpen) setDrawerOpen(false)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [
    sel,
    switcher,
    drawerOpen,
    treeList,
    toggleGlobalSwitcher,
    toggleTreeList,
    closeSwitcher,
    closeTreeList,
  ])

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

  /* ---------- 主线 hint 卡片：仅整棵树还没有任何消息时展示（判 main 即可——
       分支必经主线产生），首条消息一出现即随派生状态消失；× 可提前手动关。 ---------- */
  const hintVisible = hintManual || (!hintDismissed && !mainHasMessage)
  const hintNode = hintVisible ? (
    <div className="hint">
      <Highlighter size={15} color="#b07d2e" />
      <ul>
        <li>
          <b>划选 AI 回复里的文字</b>开分支，输入框预填相关问题，改写后回车确认
        </li>
        <li>列数随屏宽自适应（2–4 列），列满默认替换来源列（可撤销）</li>
        <li>
          按住 <span className="kbd">⌘</span>/Ctrl 划选或点脚注 ={" "}
          <b>保留本列</b>，新会话开在紧邻右侧
        </li>
        <li>拖动列间分割线调宽度，双击恢复均分</li>
        <li>面包屑可就地回退到上游会话</li>
        <li>
          <span className="kbd">⌘K</span> 搜索并打开任意会话
        </li>
        <li>
          点列头 <b>⇄</b> 把该列切换成任意会话，<b>⑂</b> 查看子分支
        </li>
        <li>分支里产出的 Artifact 从右侧抽屉弹出</li>
        <li>顶栏可切换画布视图纵览全树，双击节点回到列模式</li>
        <li>对话自动保存，刷新或同链接重开可恢复；「新对话」另起一棵树</li>
      </ul>
      <span
        className="close"
        onClick={() => {
          setHintManual(false)
          setHintDismissed(true)
        }}
      >
        ✕
      </span>
    </div>
  ) : null

  /* ---------- 顶栏数据 ---------- */
  const branchCount = Object.keys(state.threads).length - 1

  return (
    <div className="tc" ref={tcRootRef}>
      <div className="topbar">
        <button
          className="tbtn"
          title="开启一棵全新的分支对话树（当前对话已自动保存，可经其 URL 随时回访）"
          onClick={() => router.push(`/thread-chat/${crypto.randomUUID()}`)}
        >
          新对话
        </button>
        <button
          className="tbtn"
          title="查看全部对话，可切换 / 重命名 / 删除（⌘⇧K）"
          onClick={toggleTreeList}
        >
          <ListTodo size={13} />
          对话列表
          <span className="kbd">⌘⇧K</span>
        </button>
        <div className="brand">
          <span className="mark">
            Thread Chat<em>·</em>
          </span>
        </div>
        <div className="spacer" />
        {!hintVisible && (
          <button
            className="tbtn help"
            title="使用提示"
            onClick={() => setHintManual(true)}
          >
            <CircleHelp size={14} />
          </button>
        )}
        <div className="seg" title="列 = 并排深读；画布 = 纵览整棵会话树">
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
            <div
              className="seg"
              title={
                winW === null
                  ? undefined
                  : `列数：视口 ${winW}px，约每 ${COL_MIN_W}px 一列`
              }
            >
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
            <div className="seg" title="列满时的放置策略">
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
          {/* Package：贴合「产出物」语义，与抽屉头部图标一致 */}
          <Package size={13} />
          Artifact
          <span className="cnt">{state.artifactOrder.length}</span>
        </button>
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
              subtitle={threadId === "main" ? mainSubtitle : undefined}
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
          mainSubtitle={mainSubtitle}
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
            suppressSaveRef.current = v
            if (v) savePendingRef.current = false
          }}
          onDeleteCurrent={(nextId) => {
            // 当前树已被删除：抑制卸载 flush / 防抖尾巴的回写（否则 DB 行复活），
            // 再跳剩余最近一棵；一棵不剩则开新 UUID。replace 不给被删 URL 留历史。
            suppressSaveRef.current = true
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
