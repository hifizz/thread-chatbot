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

/** assistant Markdown 划选的唯一 document 观察器与锚点采集边界。
 *  hasDraft：气泡输入框里有草稿时不允许「轻松取消」——外部点击 / 空选 /
 *  滚动都不关闭气泡，新划选也一律忽略（保留 DOM 选区供复制粘贴进输入框）。
 *  关闭/换锚入口只剩：提交、Esc 确认清空。 */
export function useAssistantTextSelection({
  state,
  selection,
  onSelectionChange,
  hasDraft = false,
  onIgnoredSelection,
}: {
  state: ThreadTreeState
  selection: SelectionInfo | null
  onSelectionChange: (selection: SelectionInfo | null) => void
  hasDraft?: boolean
  /** 有草稿时新划选被忽略（不替换不关闭，方便用户划选别处复制粘贴进输入框），
      每次真正拖出一段新选区都会回调一次，组件用它弹轻提示解释「为什么气泡没跟过来」 */
  onIgnoredSelection?: () => void
}) {
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const onMouseUp = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest?.(".sel-bubble")) return
      const meta = event.metaKey || event.ctrlKey
      if (settleTimer) clearTimeout(settleTimer)
      // 等浏览器把 Selection 结算完再读（与拖选结束存在竞态）。
      settleTimer = setTimeout(() => {
        // 有草稿时外部点击（会清空 DOM 选区）不关气泡，内容只能显式提交或确认清空
        const closeIfUnguarded = () => {
          if (!hasDraft) onSelectionChange(null)
        }
        const domSelection = window.getSelection()
        const text = domSelection?.toString().trim() ?? ""
        if (!domSelection || !text || text.length < 2) {
          closeIfUnguarded()
          return
        }
        // 有草稿时拖出的新选区一律忽略（DOM 选区保留，用户正要复制它）：
        // 既不清空草稿换锚，也不关气泡 —— 复制粘贴流的关键一路径
        if (hasDraft) {
          onIgnoredSelection?.()
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
          closeIfUnguarded()
          return
        }
        const list = markdownRoot.closest(".msg-list") as HTMLElement | null
        const messageElement = markdownRoot.closest(
          ".message"
        ) as HTMLElement | null
        const threadId = list?.dataset.list
        const msgId = messageElement?.dataset.msgId
        if (!threadId || !msgId) return
        if (
          !state.threads[threadId]?.messages.some(
            (message) => message.id === msgId
          )
        ) {
          closeIfUnguarded()
          return
        }

        const anchor = describeRange(markdownRoot, domSelection.getRangeAt(0))
        if (!anchor || anchor.quote.exact.trim().length < 2) {
          closeIfUnguarded()
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
      if (!(event.target as HTMLElement).closest?.(".sel-bubble") && !hasDraft)
        onSelectionChange(null)
    }
    const onResize = () => {
      if (!hasDraft) onSelectionChange(null)
    }
    document.addEventListener("mouseup", onMouseUp)
    document.addEventListener("mousedown", onMouseDown)
    window.addEventListener("resize", onResize)
    return () => {
      if (settleTimer) clearTimeout(settleTimer)
      document.removeEventListener("mouseup", onMouseUp)
      document.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("resize", onResize)
    }
  }, [state, onSelectionChange, hasDraft, onIgnoredSelection])

  useEffect(() => {
    if (!selection) return
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Element) {
        if (target.closest(".sel-bubble")) return
        const list = target.closest<HTMLElement>(".msg-list[data-list]")
        if (list && list.dataset.list !== selection.threadId) return
      }
      // 有草稿时滚动也不关气泡（尾巴会暂时离开选区，但内容不丢；
      // 提交 / 确认清空才关）
      if (hasDraft) return
      onSelectionChange(null)
    }
    document.addEventListener("scroll", onScroll, true)
    return () => document.removeEventListener("scroll", onScroll, true)
  }, [selection, onSelectionChange, hasDraft])
}
