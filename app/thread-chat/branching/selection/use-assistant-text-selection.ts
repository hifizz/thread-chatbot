"use client"

import { useEffect } from "react"
import type { ThreadTreeState } from "../../core/types"
import { describeRange, type TextAnchor } from "./text-anchor"
import type { Rect } from "./bubble-position"

export interface SelectionInfo {
  text: string
  threadId: string
  msgId: string
  /** 选区包围盒（viewport 坐标）：喂 floating-popup 定位模型，气泡围绕它择位 */
  rect: Rect
  /** 划选结束（mouseup）那一刻是否按着 ⌘/Ctrl：作为修饰键跟踪的初值 */
  meta?: boolean
  /** 文本锚点（在渲染后的 .md-body 上以 describeRange 生成）：渲染后重定位高亮用 */
  anchor: TextAnchor
}

/** assistant Markdown 划选的唯一 document 观察器与锚点采集边界。 */
export function useAssistantTextSelection({
  state,
  selection,
  onSelectionChange,
}: {
  state: ThreadTreeState
  selection: SelectionInfo | null
  onSelectionChange: (selection: SelectionInfo | null) => void
}) {
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const onMouseUp = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest?.(".sel-bubble")) return
      const meta = event.metaKey || event.ctrlKey
      if (settleTimer) clearTimeout(settleTimer)
      // 等浏览器把 Selection 结算完再读（与拖选结束存在竞态）。
      settleTimer = setTimeout(() => {
        const domSelection = window.getSelection()
        const text = domSelection?.toString().trim() ?? ""
        if (!domSelection || !text || text.length < 2) {
          onSelectionChange(null)
          return
        }
        const node = domSelection.anchorNode
        if (!node) return
        const base =
          node.nodeType === Node.TEXT_NODE
            ? (node as Text).parentElement
            : (node as HTMLElement)
        const markdownRoot = base?.closest?.(".md-body") as HTMLElement | null
        if (!markdownRoot) {
          onSelectionChange(null)
          return
        }
        const list = markdownRoot.closest(".msg-list") as HTMLElement | null
        const messageElement = markdownRoot.closest(
          ".message"
        ) as HTMLElement | null
        const threadId = list?.dataset.list
        const msgId = messageElement?.dataset.msgId
        if (!threadId || !msgId) return
        const sourceMessage = state.threads[threadId]?.messages.find(
          (message) => message.id === msgId
        )
        if (
          !sourceMessage ||
          sourceMessage.role !== "assistant" ||
          sourceMessage.status === "pending" ||
          sourceMessage.status === "streaming" ||
          sourceMessage.status === "error"
        ) {
          onSelectionChange(null)
          return
        }

        const anchor = describeRange(markdownRoot, domSelection.getRangeAt(0))
        if (!anchor || anchor.quote.exact.trim().length < 2) {
          onSelectionChange(null)
          return
        }
        const rect = domSelection.getRangeAt(0).getBoundingClientRect()
        onSelectionChange({
          text: anchor.quote.exact,
          threadId,
          msgId,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
          meta,
          anchor,
        })
      }, 10)
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest?.(".sel-bubble"))
        onSelectionChange(null)
    }
    const onResize = () => onSelectionChange(null)
    document.addEventListener("mouseup", onMouseUp)
    document.addEventListener("mousedown", onMouseDown)
    window.addEventListener("resize", onResize)
    return () => {
      if (settleTimer) clearTimeout(settleTimer)
      document.removeEventListener("mouseup", onMouseUp)
      document.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("resize", onResize)
    }
  }, [state, onSelectionChange])

  useEffect(() => {
    if (!selection) return
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Element) {
        if (target.closest(".sel-bubble")) return
        const list = target.closest<HTMLElement>(".msg-list[data-list]")
        if (list && list.dataset.list !== selection.threadId) return
      }
      onSelectionChange(null)
    }
    document.addEventListener("scroll", onScroll, true)
    return () => document.removeEventListener("scroll", onScroll, true)
  }, [selection, onSelectionChange])
}
