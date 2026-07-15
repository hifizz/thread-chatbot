"use client"
/**
 * branching/selection-bubble —— 划选 assistant 消息文字 → 迷你气泡 → 开分支。
 *
 * document 级监听 + 命令式 DOM Selection 读取（这部分天然绕不开命令式 API）。
 * 气泡的开合状态由上层持有（sel / onSelChange），以便 Esc 逐层关闭链能先关它。
 *
 * 放置控制（存在 ≥1 个分支列时显示，见任务「打开到哪一列」）：
 * · 底部迷你列条按当前列序预览「新分支会放到哪」——将替换（斜纹）/ 将折叠 / 插入
 *   位置的虚线幽灵格，全部来自 placement.previewPlacement（与提交共用同一套规则，
 *   预览不撒谎）；主线小格锚定不可选；
 * · 点非主线小格 = 显式指定让位列（override，再点同格取消）；
 * · 按住 ⌘/Ctrl = 保留来源列、新列开在其紧邻右侧（气泡实时跟踪修饰键，按钮文案
 *   与列条目标同步切换）。生效目标 = override > 修饰键 > 默认规则。
 *
 * 可选输入框（Phase A，openspec: add-bubble-composer）：
 * · 输入后提交 = 带问开分支：问题经 onFork 第三参传给壳层，fork 后直接 chat.send
 *   成为新分支第 1 条 user 消息（不进 composer 预填流）；
 * · 留空提交 = 现有预填流原样保留（空分支 + composer 预填代拟问题 + 回车确认）；
 * · 键位：Enter 提交 / Shift+Enter 换行 / ⌘Ctrl+Enter 提交且保留来源列 /
 *   Esc 交由壳层关闭链关气泡；Enter 有 IME 守卫（isComposing / keyCode 229）。
 */

import React, { useEffect, useRef, useState } from "react"
import { GitFork } from "lucide-react"
import type { ThreadTreeState } from "../core/types"
import { threadTitle } from "../core/selectors"
import { describeRange, type TextAnchor } from "./text-anchor"
import {
  previewPlacement,
  type PlacementHint,
  type PlacementMode,
  type Slot,
} from "../orchestration/placement"

export interface SelectionInfo {
  text: string
  threadId: string
  msgId: string
  x: number
  y: number
  /** 划选结束（mouseup）那一刻是否按着 ⌘/Ctrl：作为修饰键跟踪的初值 */
  meta?: boolean
  /** 文本锚点（在渲染后的 .md-body 上以 describeRange 生成）：渲染后重定位高亮用 */
  anchor: TextAnchor
}

export interface SelectionBubbleProps {
  state: ThreadTreeState
  sel: SelectionInfo | null
  onSelChange: (s: SelectionInfo | null) => void
  /** 提交开分支：上层负责真正 fork + 放置；hint 见 placement.ts；
      question = 气泡输入框里的可选首问（trim 后非空才传，成为新分支第 1 条 user 消息） */
  onFork: (s: SelectionInfo, hint?: PlacementHint, question?: string) => void
  /* —— 迷你列条的放置上下文（与提交走同一套 placement 规则）—— */
  slots: Slot[]
  mode: PlacementMode
  maxExpanded: number
  lastActiveOf: (id: string) => number
}

export function SelectionBubble({
  state,
  sel,
  onSelChange,
  onFork,
  slots,
  mode,
  maxExpanded,
  lastActiveOf,
}: SelectionBubbleProps) {
  /** 迷你列条点选的让位列（override）；气泡隐藏 / 换一段划选时清空 */
  const [override, setOverride] = useState<string | null>(null)
  /** ⌘/Ctrl 是否按住（实时跟踪，目标与按钮文案随之切换） */
  const [metaHeld, setMetaHeld] = useState(false)
  /** 可选首问（受控 textarea）：留空提交 = 现有预填流；非空提交 = 带问开分支 */
  const [question, setQuestion] = useState("")
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  /** 渲染期间的派生状态调整（React 官方写法）：sel 变化 = 新一次划选，重置各态 */
  const [forSel, setForSel] = useState<SelectionInfo | null>(sel)
  if (forSel !== sel) {
    setForSel(sel)
    setOverride(null)
    setMetaHeld(sel?.meta ?? false)
    setQuestion("")
  }

  /* 气泡弹出即聚焦输入框（preventScroll：气泡定位刚结算完，不能再引发滚动）；
     顺手清掉上一次自增高留下的行内高度（textarea 跨划选不重挂载） */
  useEffect(() => {
    const ta = taRef.current
    if (!sel || !ta) return
    ta.style.height = ""
    ta.focus({ preventScroll: true })
  }, [sel])

  /* 划选监听：mouseup 结算选区并定位气泡；mousedown / 滚动 / resize 隐藏 */
  useEffect(() => {
    // 有分支列时气泡多出一行迷你列条（约 46px），夹取阈值同步放大避免贴底裁切
    const extraH = slots.length > 0 ? 46 : 0
    const onMouseUp = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.(".sel-bubble")) return
      const meta = e.metaKey || e.ctrlKey
      // 等浏览器把 Selection 结算完再读（与拖选结束存在竞态）
      setTimeout(() => {
        const s = window.getSelection()
        const txt = s?.toString().trim() ?? ""
        if (!s || !txt || txt.length < 2) {
          onSelChange(null)
          return
        }
        const node = s.anchorNode
        if (!node) return
        const base =
          node.nodeType === Node.TEXT_NODE
            ? (node as Text).parentElement
            : (node as HTMLElement)
        // 以命中的 assistant Markdown 容器 .md-body 为锚点坐标系容器
        const mdRoot = base?.closest?.(".md-body") as HTMLElement | null
        if (!mdRoot) {
          onSelChange(null)
          return
        }
        const listEl = mdRoot.closest(".msg-list") as HTMLElement | null
        const msgEl = mdRoot.closest(".message") as HTMLElement | null
        const threadId = listEl?.dataset.list
        const msgId = msgEl?.dataset.msgId
        if (!threadId || !msgId) return
        const msg = state.threads[threadId]?.messages.find(
          (m) => m.id === msgId
        )
        if (!msg) {
          onSelChange(null)
          return
        }

        /* —— 采集锚点：以 .md-body（渲染后的 Markdown DOM）为坐标系，describeRange
           生成 { quote:{exact,prefix,suffix}, position }。text 取 quote.exact，与锚点解耦，
           渲染后经 locateAnchor 三层降级重定位。describeRange 成功即视为有效。 */
        const anchor = describeRange(mdRoot, s.getRangeAt(0))
        if (!anchor || anchor.quote.exact.trim().length < 2) {
          onSelChange(null)
          return
        }
        const text = anchor.quote.exact

        const rect = s.getRangeAt(0).getBoundingClientRect()
        const left = Math.max(10, Math.min(rect.left, window.innerWidth - 244))
        let top = rect.bottom + 9
        // 贴底翻转阈值：150/132 → 190/172，多出的 ~40px 是输入框一行的高度（D5）
        if (top > window.innerHeight - (190 + extraH))
          top = Math.max(10, rect.top - (172 + extraH))
        onSelChange({
          text,
          threadId,
          msgId,
          x: left,
          y: top,
          meta,
          anchor,
        })
      }, 10)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".sel-bubble")) onSelChange(null)
    }
    const onScroll = (e: Event) => {
      // 气泡内部的滚动（输入长问题时 textarea 自增高 / 内滚）不算「用户离开」——
      // capture 监听会先于一切收到它，必须放行，否则打字打到换行气泡就自毁丢输入（D4）。
      // resize 事件的 target 是 window（无 closest），自然落到关闭分支。
      const t = e.target as Partial<HTMLElement> | null
      if (t?.closest?.(".sel-bubble")) return
      onSelChange(null)
    }
    document.addEventListener("mouseup", onMouseUp)
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onScroll)
    return () => {
      document.removeEventListener("mouseup", onMouseUp)
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onScroll)
    }
  }, [state, onSelChange, slots])

  /* 气泡打开期间跟踪 ⌘/Ctrl 起落（keydown/keyup 都带 metaKey/ctrlKey 快照） */
  useEffect(() => {
    if (!sel) return
    const sync = (e: KeyboardEvent) => setMetaHeld(e.metaKey || e.ctrlKey)
    const onBlur = () => setMetaHeld(false)
    document.addEventListener("keydown", sync)
    document.addEventListener("keyup", sync)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("keydown", sync)
      document.removeEventListener("keyup", sync)
      window.removeEventListener("blur", onBlur)
    }
  }, [sel])

  if (!sel) return null

  /* —— 生效目标 = override > 修饰键推导 > 默认规则（列条与提交共用 hint） —— */
  const ov =
    override && slots.some((s) => s.id === override && !s.folded)
      ? override
      : null
  const hint: PlacementHint | undefined = ov
    ? { targetId: ov }
    : metaHeld
      ? { keepSource: true }
      : undefined
  const hasMap = slots.length > 0 // 仅主线时无需放置控制，不显示列条
  const preview = hasMap
    ? previewPlacement(mode, slots, {
        sourceId: sel.threadId,
        maxExpanded,
        lastActiveOf,
        hint,
      })
    : null

  /* —— 按钮文案四态（优先级）：列条 override > ⌘ 按住 > 有输入 > 默认 —— */
  const hasQuestion = question.trim().length > 0
  // 按钮只表达「动作」（两态、长度稳定）；「放置后果」下沉到列条下的提示行——
  // 变长的列标题在提示行里可单行省略，按钮宽度不再被撑爆（用户定的通用方案）
  const btnLabel = hasQuestion ? "带着问题开分支" : "开启分支讨论"

  /** 放置后果提示行：override 优先，其次 ⌘ 跟踪态，否则读 placement 预览 */
  const placeHint = ov
    ? `将${mode === "replace" ? "替换" : "折叠"}『${threadTitle(state, ov)}』`
    : metaHeld
      ? "⌘ 保留本列 · 新列开在紧邻右侧"
      : preview?.replaceId
        ? `默认替换『${threadTitle(state, preview.replaceId)}』（点小格可换）`
        : preview?.foldId
          ? `默认折叠『${threadTitle(state, preview.foldId)}』（点小格可换）`
          : preview
            ? "将在右侧新开一列"
            : null

  /** 统一提交：按钮点击与输入框 Enter 共用（事件瞬时修饰键与跟踪态任一为真即 keepSource）。
      question trim 后非空 = 带问开分支；留空 = 现有预填流（上层据第三参分流） */
  const submit = (metaFromEvent: boolean) => {
    const h: PlacementHint | undefined = ov
      ? { targetId: ov }
      : metaFromEvent || metaHeld
        ? { keepSource: true }
        : undefined
    const q = question.trim()
    window.getSelection()?.removeAllRanges()
    onSelChange(null)
    onFork(sel, h, q || undefined)
  }

  /* —— 迷你列条：主线 + 各槽位（+ 插入位置的幽灵格），标注将替换 / 将折叠 / 本列 —— */
  const ghost = (
    <span
      key="ghost"
      className="smcell ghost"
      title="新分支将插入此处"
      aria-hidden="true"
    >
      +
    </span>
  )
  const cells: React.ReactNode[] = []
  if (hasMap) {
    cells.push(
      <span
        key="main"
        className="smcell main"
        role="button"
        aria-disabled="true"
        title={threadTitle(state, "main")}
        aria-label={threadTitle(state, "main")}
      />
    )
    const showGhost = preview !== null && preview.replaceId === null
    slots.forEach((s, i) => {
      if (showGhost && preview.insertAt === i) cells.push(ghost)
      const title = threadTitle(state, s.id)
      const isSrc = s.id === sel.threadId
      const willReplace = preview?.replaceId === s.id
      const willFold = preview?.foldId === s.id
      const cap = willReplace
        ? isSrc
          ? "本列·替"
          : "将替换"
        : willFold
          ? isSrc
            ? "本列·折"
            : "将折叠"
          : isSrc
            ? "本列"
            : null
      const toggle = () => setOverride((o) => (o === s.id ? null : s.id))
      cells.push(
        <span
          key={s.id}
          className={`smcell${s.folded ? "folded" : ""}${isSrc ? "src" : ""}${
            willReplace ? "will-replace" : ""
          }${willFold ? "will-fold" : ""}${ov === s.id ? "ov" : ""}`}
          role="button"
          tabIndex={s.folded ? -1 : 0}
          aria-disabled={s.folded ? "true" : undefined}
          title={title}
          aria-label={title}
          onClick={s.folded ? undefined : toggle}
          onKeyDown={
            s.folded
              ? undefined
              : (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    toggle()
                  }
                }
          }
        >
          {cap && <i className="cap">{cap}</i>}
        </span>
      )
    })
    if (showGhost && preview.insertAt === slots.length) cells.push(ghost)
  }

  return (
    <div className="sel-bubble" style={{ left: sel.x, top: sel.y }}>
      <div className="lbl">在新分支中讨论这段</div>
      <div className="quote">{sel.text}</div>
      <div className="ask">
        <textarea
          ref={taRef}
          rows={1}
          value={question}
          placeholder="就这段问点什么…（可留空）"
          aria-label="就这段划选文字提出你的问题（可留空，留空则预填代拟问题待确认）"
          onChange={(e) => {
            setQuestion(e.target.value)
            // 自增高：clamp 68px（与 CSS 的 max-height 同步），超出转内滚
            const ta = e.currentTarget
            ta.style.height = "auto"
            ta.style.height = Math.min(ta.scrollHeight, 68) + "px"
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            // IME 守卫（同 chat-view composer）：输入法组合态按 Enter 只做「上屏」，
            // 不提交、也不 preventDefault。isComposing 覆盖 Chrome/Firefox；
            // keyCode 229 兜底 Safari（compositionend 后才派发的 Enter keydown）。
            const ne = e.nativeEvent
            if (ne.isComposing || ne.keyCode === 229) return
            if (e.shiftKey) return // Shift+Enter = 换行（浏览器默认行为）
            e.preventDefault()
            submit(e.metaKey || e.ctrlKey)
          }}
        />
      </div>
      {hasMap && (
        <div
          className="slotmap"
          role="group"
          aria-label="新分支的放置目标（点小格指定让位列）"
        >
          {cells}
        </div>
      )}
      {placeHint && (
        <div className="place-hint" aria-live="polite">
          {placeHint}
        </div>
      )}
      <button onClick={(e) => submit(e.metaKey || e.ctrlKey)}>
        <GitFork size={14} />
        {btnLabel}
      </button>
    </div>
  )
}
