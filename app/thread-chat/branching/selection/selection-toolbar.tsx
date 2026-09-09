"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { GitBranch, MessageSquareReply } from "lucide-react"
import { SELECTION_TOOLBAR_COPY as COPY, SELECTION_TOOLBAR_WIDTH } from "@/constants/selection-toolbar"
import { BUBBLE_GAP, BUBBLE_SAFE_PADDING } from "@/constants/selection-bubble"
import { computePopupPosition, type Rect } from "./bubble-position"

/** 只负责工具条展示、定位和键盘导航；操作由调用方接入。 */
export function SelectionToolbar({ rect, onContinue, onBranch }: {
  rect: Rect; onContinue(): void; onBranch(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const width = typeof window === "undefined" ? SELECTION_TOOLBAR_WIDTH : Math.min(SELECTION_TOOLBAR_WIDTH, window.innerWidth - BUBBLE_SAFE_PADDING * 2)
  const position = height ? computePopupPosition(rect, { width, height }, {
    left: 0, top: 0, width: window.innerWidth, height: window.innerHeight,
  }, { sides: ["top", "bottom"], gap: BUBBLE_GAP, safePadding: BUBBLE_SAFE_PADDING }) : null
  return <div ref={ref} className="selection-toolbar" data-positioned={Boolean(position)} role="toolbar" aria-label={COPY.label}
    style={{ width, left: position?.left, top: position?.top, visibility: position ? "visible" : "hidden" }}
    onPointerDown={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      const buttons = Array.from(event.currentTarget.querySelectorAll("button"))
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length
      event.preventDefault()
      buttons[next]?.focus()
    }}>
    <button type="button" title={COPY.continueLabel} onClick={onContinue}><MessageSquareReply size={16} aria-hidden="true" />{COPY.continue}</button>
    <button type="button" title={COPY.branchLabel} onClick={onBranch}><GitBranch size={16} aria-hidden="true" />{COPY.branch}</button>
  </div>
}
