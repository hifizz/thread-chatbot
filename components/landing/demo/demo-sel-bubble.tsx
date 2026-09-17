"use client"

/**
 * demo/demo-sel-bubble —— 划选提问气泡。
 * 渲染在 .ld 根级而非消息内：脱离列的 overflow 裁剪与层叠上下文，
 * 高于所有分栏不被盖住。两种定位：
 *  - anchorId：剧本模式，高频实测锚点位置跟随（列滑入/重排不脱锚）；
 *  - fixedPos：手动划选模式，直接落在选区下方。
 * 输入框是真实 textarea：可 focus（border 高亮）、可改写。
 */

import { GitMerge } from "lucide-react"
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react"

export const SEL_BUBBLE_W = 246
/** 估算高度，用于贴近容器底部时翻到锚点上方 */
export const SEL_BUBBLE_H = 180
const PAD = 8

interface Props {
  /** 引用的划选原文 */
  quote: string
  /** 输入框受控值 */
  value: string
  /** 可编辑（真实输入）；默认只读展示 */
  editable?: boolean
  autoFocus?: boolean
  /** 聚焦回调（暂停播放等，不算改写） */
  onFocusEdit?: () => void
  /** 真实输入回调（视为改写） */
  onChange?: (v: string) => void
  onSubmit: () => void
  /** Esc / 点外部关闭（手动模式） */
  onDismiss?: () => void
  /** 剧本模式：跟随的锚点 */
  anchorId?: string
  /** 手动模式：选区下方的固定位置（.ld 相对坐标） */
  fixedPos?: { x: number; y: number }
  rootRef: RefObject<HTMLElement | null>
}

export function DemoSelBubble({
  quote,
  value,
  editable,
  autoFocus,
  onFocusEdit,
  onChange,
  onSubmit,
  onDismiss,
  anchorId,
  fixedPos,
  rootRef,
}: Props): ReactElement | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(
    fixedPos ?? null,
  )
  const areaRef = useRef<HTMLTextAreaElement>(null)

  /* 锚点模式：锚点随流式文本/列动画移动，高频复测跟随。
     用 setInterval 而非 rAF：页面不可见时 rAF 会被节流导致气泡不渲染。 */
  useLayoutEffect(() => {
    if (!anchorId) return
    const measure = () => {
      const root = rootRef.current
      const el = root?.querySelector<HTMLElement>(
        `[data-cursor-target="anchor-${anchorId}"]`,
      )
      if (root && el) {
        const rr = root.getBoundingClientRect()
        const ar = el.getBoundingClientRect()
        const offscreen =
          ar.bottom < rr.top || ar.top > rr.bottom || ar.right < rr.left
        if (offscreen) {
          setPos((prev) => (prev === null ? prev : null))
        } else {
          const x = Math.max(
            PAD,
            Math.min(ar.left - rr.left, rr.width - SEL_BUBBLE_W - PAD),
          )
          let y = ar.bottom - rr.top + PAD
          if (y + SEL_BUBBLE_H > rr.height - PAD)
            y = ar.top - rr.top - SEL_BUBBLE_H - PAD
          setPos((prev) =>
            prev && prev.x === x && prev.y === y ? prev : { x, y },
          )
        }
      }
    }
    measure()
    const id = window.setInterval(measure, 50)
    return () => window.clearInterval(id)
  }, [rootRef, anchorId])

  useLayoutEffect(() => {
    if (autoFocus) areaRef.current?.focus()
  }, [autoFocus])

  if (!pos) return null

  return (
    <div
      className="sel-bubble"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="在新分支中讨论这段"
    >
      <span className="lbl">在新分支中讨论这段</span>
      <span className="quote">{quote}</span>
      <textarea
        ref={areaRef}
        className="ask"
        rows={2}
        value={value}
        placeholder="就这段问点什么…（可留空）"
        readOnly={!editable}
        data-cursor-target="bubble-input"
        onFocus={editable ? onFocusEdit : undefined}
        onChange={
          editable ? (e) => onChange?.(e.target.value) : undefined
        }
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            onDismiss?.()
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
      <button
        type="button"
        className="go"
        data-cursor-target="bubble-submit"
        onClick={onSubmit}
      >
        <GitMerge size={13} aria-hidden />
        {value.trim() ? "带着问题开分支" : "开启分支讨论"}
      </button>
    </div>
  )
}
