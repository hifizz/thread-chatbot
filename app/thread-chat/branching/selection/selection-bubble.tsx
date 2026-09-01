"use client"
/**
 * branching/selection-bubble —— 划选 assistant 消息文字 → 迷你气泡 → 开分支。
 *
 * document 级划选监听与命令式 DOM Selection 读取由
 * useAssistantTextSelection 封装；本组件组合气泡状态、定位、放置预览与提交 UI。
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

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import "./selection-draft-guard.css"
import { GitMerge } from "lucide-react"
import type { ThreadTreeState } from "../../core/types"
import { threadTitle } from "../../core/selectors"
import {
  previewPlacement,
  type PlacementHint,
  type PlacementMode,
  type Slot,
} from "../../orchestration/columns/placement"
import { computePopupPosition } from "./bubble-position"
import { BubbleShape, type TailDir } from "./bubble-shape"
import { SELECTION_QUESTION_MAX_HEIGHT } from "./selection-composer-dimensions"
import {
  useAssistantTextSelection,
  type SelectionInfo,
} from "./use-assistant-text-selection"
import { SelectionPlacementMap } from "./selection-placement-map"
import {
  BUBBLE_GAP,
  BUBBLE_SAFE_PADDING,
  BUBBLE_TAIL,
  BUBBLE_TAIL_MARGIN,
  BUBBLE_W,
} from "@/constants/selection-bubble"

export type { SelectionInfo } from "./use-assistant-text-selection"

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
  /** 可选首问（受控 textarea）：留空提交 = 现有预填流；非空提交 = 带问开分支 */
  const [question, setQuestion] = useState("")
  const hasQuestion = question.trim().length > 0
  /** 有草稿时新划选被忽略的轻提示（悬挂在气泡外，不扰动面板高度/定位） */
  const [draftHint, setDraftHint] = useState(false)
  /** 轻提示自动消失计时器（再次忽略新划选时重置） */
  const draftHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showDraftHint = useCallback(() => {
    setDraftHint(true)
    if (draftHintTimer.current) clearTimeout(draftHintTimer.current)
    draftHintTimer.current = setTimeout(() => setDraftHint(false), 2500)
  }, [])
  useEffect(
    () => () => {
      if (draftHintTimer.current) clearTimeout(draftHintTimer.current)
    },
    []
  )
  useAssistantTextSelection({
    state,
    selection: sel,
    onSelectionChange: onSelChange,
    hasDraft: hasQuestion,
    onIgnoredSelection: showDraftHint,
  })
  /** Esc 确认弹窗（有草稿时 Esc 不直接关，先确认清空） */
  const [confirming, setConfirming] = useState(false)
  /** 气泡左右抖动中（确认弹窗弹出时触发一次，animationend 归位） */
  const [shaking, setShaking] = useState(false)
  /** 入场淡入窗口：tc-pop 播完即拆 .entering 类，让稳态 animation 为 none（见 selection.css） */
  const [entering, setEntering] = useState(true)
  /** 迷你列条点选的让位列（override）；气泡隐藏 / 换一段划选时清空 */
  const [override, setOverride] = useState<string | null>(null)
  /** ⌘/Ctrl 是否按住（实时跟踪，目标与按钮文案随之切换） */
  const [metaHeld, setMetaHeld] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  /** 气泡内容层（面板本体）：测其高度 H 喂定位模型与轮廓 path */
  const contentRef = useRef<HTMLDivElement | null>(null)
  /** 实测面板高度（内容驱动：输入框自增高、迷你列条出现都会变），0 = 尚未测量 */
  const [measuredH, setMeasuredH] = useState(0)
  /** 渲染期间的派生状态调整（React 官方写法）：sel 变化 = 新一次划选，重置各态 */
  const [forSel, setForSel] = useState<SelectionInfo | null>(sel)
  if (forSel !== sel) {
    setForSel(sel)
    setOverride(null)
    setMetaHeld(sel?.meta ?? false)
    setQuestion("")
    setConfirming(false)
    setShaking(false)
    setDraftHint(false)
    setMeasuredH(0) // 换一段划选：高度作废，等重新测量再定位（先隐藏，避免旧位闪现）
  }

  /* 测量面板高度：内容变化（打字自增高 / 列条出现）经 ResizeObserver 实时回填，
     驱动定位模型重新择位（贴底时自动上下翻转），气泡不会被 viewport 裁切 */
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!sel || !el) return
    // 清掉上一次划选留在 textarea 上的自增高（跨划选不重挂载），否则首帧量到偏大的 H
    if (taRef.current) taRef.current.style.height = ""
    const measure = () => setMeasuredH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sel])

  /* 气泡弹出即聚焦输入框（preventScroll：气泡定位刚结算完，不能再引发滚动）；
     顺手清掉上一次自增高留下的行内高度（textarea 跨划选不重挂载） */
  useEffect(() => {
    const ta = taRef.current
    if (!sel || !ta) return
    ta.style.height = ""
    ta.focus({ preventScroll: true })
  }, [sel])

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

  /* 有草稿时拦截 Esc（capture：先于壳层 use-workspace-overlays 的关闭链）：
     · 确认弹窗已开 → 再按 Esc 只关确认弹窗（回到编辑，内容保留）；
     · 未开 → 弹出「清空并关闭」确认，同时气泡左右抖动提醒内容会丢；
     · 无草稿 → 不拦截，Esc 照旧直接关气泡。IME 组合态的 Esc 不拦截。 */
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return
      if (!question.trim()) return
      e.preventDefault()
      e.stopPropagation()
      if (confirming) {
        setConfirming(false)
        return
      }
      setConfirming(true)
      setShaking(true)
      setEntering(false)
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [sel, question, confirming])

  if (!sel) return null

  /* —— 落点：floating-popup 定位模型，只用上/下两向（尾巴竖直指向选区）——
     测得高度前（measuredH=0）先把气泡藏到屏外并隐藏，测完这一帧即就位，避免旧位闪现。 */
  const ready = measuredH > 0 && typeof window !== "undefined"
  const pos = ready
    ? computePopupPosition(
        sel.rect,
        { width: BUBBLE_W, height: measuredH },
        {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        },
        {
          sides: ["bottom", "top"],
          gap: BUBBLE_GAP,
          safePadding: BUBBLE_SAFE_PADDING,
        }
      )
    : null
  // side="bottom"（面板在选区下方）→ 尾巴朝上；side="top"（面板在上方）→ 尾巴朝下
  const dir: TailDir = pos?.side === "top" ? "down" : "up"
  // 尾巴横向落点：对准选区中心，夹进面板安全范围（不让根部爬上圆角）
  const anchorCx = sel.rect.left + sel.rect.width / 2
  const cx = pos
    ? Math.min(
        BUBBLE_W - BUBBLE_TAIL_MARGIN,
        Math.max(BUBBLE_TAIL_MARGIN, anchorCx - pos.left)
      )
    : BUBBLE_W / 2

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

  /** 确认清空：关气泡并丢弃草稿（唯一能丢弃草稿的路径） */
  const discardDraft = () => {
    setConfirming(false)
    setQuestion("")
    window.getSelection()?.removeAllRanges()
    onSelChange(null)
  }

  return (
    <>
      <div
        className={
          shaking
            ? "sel-bubble shaking"
            : entering
              ? "sel-bubble entering"
              : "sel-bubble"
        }
        data-dir={dir}
        onAnimationEnd={(e) => {
          // animationend 会冒泡，只认气泡自身画布上的两个动画
          if (e.target !== e.currentTarget) return
          if (e.animationName === "tc-shake-x") setShaking(false)
          else if (e.animationName === "tc-pop") setEntering(false)
        }}
        style={{
          left: pos ? pos.left : -9999,
          top: pos ? pos.top : -9999,
          width: BUBBLE_W,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {/* 平滑曲线轮廓（背景层）：面板 + 指向选区的尾巴，一条 path。尾巴朝上时
          整层上移 ah 让顶点探出面板上沿；朝下时留在原位向下探出。 */}
        <div
          className="sb-shape"
          aria-hidden="true"
          style={{ top: dir === "up" ? -BUBBLE_TAIL.ah : 0 }}
        >
          {ready && (
            <BubbleShape
              W={BUBBLE_W}
              H={measuredH}
              cx={cx}
              geo={BUBBLE_TAIL}
              dir={dir}
              shadow={false}
            />
          )}
        </div>
        <div className="sb-content" ref={contentRef}>
          <div className="lbl">在新分支中讨论这段</div>
          <div className="quote">{sel.text}</div>
          <div className="ask">
            <textarea
              ref={taRef}
              rows={1}
              value={question}
              style={
                {
                  "--selection-question-max-height": `${SELECTION_QUESTION_MAX_HEIGHT}px`,
                } as React.CSSProperties
              }
              placeholder="就这段问点什么…（可留空）"
              aria-label="就这段划选文字提出你的问题（可留空，留空则预填代拟问题待确认）"
              onChange={(e) => {
                setQuestion(e.target.value)
                // 自增高：到达同一尺寸源定义的上限后转为内部滚动。
                const ta = e.currentTarget
                ta.style.height = "auto"
                ta.style.height =
                  Math.min(ta.scrollHeight, SELECTION_QUESTION_MAX_HEIGHT) +
                  "px"
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
          {preview && (
            <SelectionPlacementMap
              sourceThreadId={sel.threadId}
              slots={slots}
              preview={preview}
              override={ov}
              titleOf={(threadId) => threadTitle(state, threadId)}
              onToggleOverride={(threadId) =>
                setOverride((current) =>
                  current === threadId ? null : threadId
                )
              }
            />
          )}
          {placeHint && (
            <div className="place-hint" aria-live="polite">
              {placeHint}
            </div>
          )}
          <button onClick={(e) => submit(e.metaKey || e.ctrlKey)}>
            <GitMerge size={14} />
            {btnLabel}
          </button>
        </div>
        {/* 有草稿时新划选被忽略的轻提示：绝对定位悬挂在面板外，不改变面板高度/定位 */}
        {draftHint && (
          <div className="draft-hint" role="status">
            已有草稿 · 提交或清空后才能换划选
          </div>
        )}
      </div>
      {/* Esc 确认弹窗：提示会清空已输入内容；点遮罩 / 再按 Esc = 继续编辑（保留内容） */}
      {confirming && (
        <div
          className="sb-confirm-mask"
          onMouseDown={(e) => {
            e.stopPropagation()
            setConfirming(false)
          }}
        >
          <div
            className="sb-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sb-confirm-title"
            aria-describedby="sb-confirm-desc"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="sb-confirm-title" id="sb-confirm-title">
              清空输入内容？
            </div>
            <div className="sb-confirm-body" id="sb-confirm-desc">
              气泡里已输入的内容将被清空，划选分支也会关闭，此操作不可撤销。
            </div>
            <div className="sb-confirm-actions">
              <button
                className="ghost"
                autoFocus
                onClick={() => setConfirming(false)}
              >
                继续编辑
              </button>
              <button className="danger" onClick={discardDraft}>
                清空并关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
