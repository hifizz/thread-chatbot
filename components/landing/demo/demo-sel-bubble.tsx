"use client"

/**
 * demo/demo-sel-bubble —— 划选提问气泡。
 * 渲染在 .ld 根级而非消息内：脱离列的 overflow 裁剪与层叠上下文，
 * 逐帧实测锚点位置跟随（列滑入/重排时也不脱锚、不被相邻列盖住）。
 */

import { GitMerge } from "lucide-react"
import {
  useLayoutEffect,
  useState,
  type ReactElement,
  type RefObject,
} from "react"

import { findAnchor, type DemoScenario } from "@/constants/landing-demo"

import type { DemoView } from "./use-demo-player"

const BUBBLE_W = 246
/** 估算高度，用于贴近容器底部时翻到锚点上方 */
const BUBBLE_H = 152
const PAD = 8

interface Props {
  scenario: DemoScenario
  bubble: NonNullable<DemoView["bubble"]>
  /** 气泡输入框的打字进度 */
  chars: number
  rootRef: RefObject<HTMLElement | null>
  onSubmit: () => void
}

export function DemoSelBubble({
  scenario,
  bubble,
  chars,
  rootRef,
  onSubmit,
}: Props): ReactElement | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  /* 锚点随流式文本/列动画移动，高频复测跟随；值不变则不触发重渲染。
     用 setInterval 而非 rAF：页面不可见时 rAF 会被节流导致气泡不渲染。 */
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current
      const el = root?.querySelector<HTMLElement>(
        `[data-cursor-target="anchor-${bubble.anchorId}"]`,
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
            Math.min(ar.left - rr.left, rr.width - BUBBLE_W - PAD),
          )
          let y = ar.bottom - rr.top + PAD
          if (y + BUBBLE_H > rr.height - PAD)
            y = ar.top - rr.top - BUBBLE_H - PAD
          setPos((prev) =>
            prev && prev.x === x && prev.y === y ? prev : { x, y },
          )
        }
      }
    }
    measure()
    const id = window.setInterval(measure, 50)
    return () => window.clearInterval(id)
  }, [rootRef, bubble.anchorId])

  if (!pos) return null
  const quote = findAnchor(scenario, bubble.anchorId)?.text ?? ""
  const text = bubble.typing ? bubble.text.slice(0, chars) : bubble.text

  return (
    <div
      className="sel-bubble"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="在新分支中讨论这段"
    >
      <span className="lbl">在新分支中讨论这段</span>
      <span className="quote">{quote}</span>
      <span className="ask" data-cursor-target="bubble-input">
        {text || <span className="ph">就这段问点什么…（可留空）</span>}
        {bubble.typing && <span className="caret" aria-hidden />}
      </span>
      <button
        type="button"
        className="go"
        data-cursor-target="bubble-submit"
        onClick={onSubmit}
      >
        <GitMerge size={13} aria-hidden />
        {text.trim() ? "带着问题开分支" : "开启分支讨论"}
      </button>
    </div>
  )
}
