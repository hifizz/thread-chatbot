"use client"

import { MOBILE_SELECTION_SETTLE_MS, SELECTION_SURFACE_SELECTOR, SELECTION_TOOLBAR_SELECTOR } from "@/constants/selection-toolbar"
import { useEffect, useEffectEvent } from "react"
import type { ThreadTreeState } from "../../core/types"
import { describeRange, type TextAnchor } from "./text-anchor"
import type { Rect } from "./bubble-position"

export interface SelectionInfo {
  text: string
  threadId: string
  msgId: string
  /** 非空表示本次划选来自该 Message 产生的 Markdown Artifact。 */
  artifactId?: string
  /** 选区包围盒（viewport 坐标）：喂 floating-popup 定位模型，气泡围绕它择位 */
  rect: Rect
  /** 划选结束（mouseup）那一刻是否按着 ⌘/Ctrl：作为修饰键跟踪的初值 */
  meta?: boolean
  /** 文本锚点（在渲染后的 .md-body 上以 describeRange 生成）：渲染后重定位高亮用 */
  anchor: TextAnchor
}

// DOM 引用与可序列化选区分开保存；选区释放后由 WeakMap 自动回收。
const selectionRoots = new WeakMap<SelectionInfo, HTMLElement>()
export function getSelectionRoot(selection: SelectionInfo) {
  return selectionRoots.get(selection)
}

/** assistant Markdown 与 Markdown Artifact 共用的唯一 document 观察器与锚点采集边界。
 *  hasDraft：气泡输入框里有草稿时不允许「轻松取消」——外部点击 / 空选 /
 *  滚动都不关闭气泡，新划选也一律忽略（保留 DOM 选区供复制粘贴进输入框）。
 *  关闭/换锚入口只剩：提交、Esc 确认清空。 */
export function useAssistantTextSelection({
  state,
  selection,
  onSelectionChange,
  hasDraft = false,
  mobile = false,
  preserveEmptySelection = false,
  onIgnoredSelection,
}: {
  state: ThreadTreeState
  selection: SelectionInfo | null
  onSelectionChange: (selection: SelectionInfo | null) => void
  hasDraft?: boolean
  mobile?: boolean
  /** 手机提问收起后，浏览器已清空选区，但引用快照仍可继续使用。 */
  preserveEmptySelection?: boolean
  /** 有草稿时新划选被忽略（不替换不关闭，方便用户划选别处复制粘贴进输入框），
      每次真正拖出一段新选区都会回调一次，组件用它弹轻提示解释「为什么气泡没跟过来」 */
  onIgnoredSelection?: () => void
}) {
  // 其他消息流式更新不能不断取消手机的选区稳定计时器；读取时再取最新消息。
  const findMessage = useEffectEvent((threadId: string, msgId: string) =>
    state.threads[threadId]?.messages.find((message) => message.id === msgId)
  )
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleSelection = (meta = false) => {
      if (settleTimer) clearTimeout(settleTimer)
      // 等浏览器把 Selection 结算完再读（与拖选结束存在竞态）。
      settleTimer = setTimeout(() => {
        document.querySelector(SELECTION_TOOLBAR_SELECTOR)?.removeAttribute("data-selecting")
        // 有草稿时外部点击（会清空 DOM 选区）不关气泡，内容只能显式提交或确认清空
        const closeIfUnguarded = () => {
          if (!hasDraft) onSelectionChange(null)
        }
        const domSelection = window.getSelection()
        const text = domSelection?.toString().trim() ?? ""
        if (!domSelection || !domSelection.rangeCount || !text || text.length < 2) {
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
        const artifactSurface = markdownRoot.closest<HTMLElement>(
          "[data-selection-artifact-id]"
        )
        const list = markdownRoot.closest(".msg-list") as HTMLElement | null
        const messageElement = markdownRoot.closest(
          ".message"
        ) as HTMLElement | null
        const threadId = artifactSurface?.dataset.selectionThreadId ?? list?.dataset.list
        const msgId = artifactSurface?.dataset.selectionMessageId ?? messageElement?.dataset.msgId
        const artifactId = artifactSurface?.dataset.selectionArtifactId
        if (!threadId || !msgId) return
        const message = findMessage(threadId, msgId)
        const range = domSelection.getRangeAt(0)
        if (!message || message.role !== "assistant" || (message.status && message.status !== "done")
          || !markdownRoot.contains(range.startContainer) || !markdownRoot.contains(range.endContainer)) {
          closeIfUnguarded()
          return
        }

        const anchor = describeRange(markdownRoot, range)
        if (!anchor || anchor.quote.exact.trim().length < 2) {
          closeIfUnguarded()
          return
        }
        const rect = range.getBoundingClientRect()
        const nextSelection: SelectionInfo = {
          text: anchor.quote.exact,
          threadId,
          msgId,
          ...(artifactId ? { artifactId } : {}),
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
          meta,
          anchor,
        }
        selectionRoots.set(nextSelection, markdownRoot)
        onSelectionChange(nextSelection)
      }, mobile ? MOBILE_SELECTION_SETTLE_MS : 10)
    }
    const onMouseUp = (event: MouseEvent) => {
      if (mobile || (event.target as HTMLElement).closest?.(SELECTION_SURFACE_SELECTOR)) return
      scheduleSelection(event.metaKey || event.ctrlKey)
    }
    const onNativeSelectionChange = () => {
      if (!mobile || hasDraft) return
      if (preserveEmptySelection && !window.getSelection()?.toString().trim()) return
      const active = document.activeElement
      if (active instanceof Element && active.closest(SELECTION_SURFACE_SELECTOR)) return
      // 调整原生选区时先隐藏旧操作条，稳定后重新采集；不干预系统复制菜单。
      document.querySelector(SELECTION_TOOLBAR_SELECTOR)?.setAttribute("data-selecting", "true")
      scheduleSelection()
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!mobile && !(event.target as HTMLElement).closest?.(SELECTION_SURFACE_SELECTOR) && !hasDraft)
        onSelectionChange(null)
    }
    const onResize = () => {
      if (!hasDraft && !mobile) onSelectionChange(null)
    }
    document.addEventListener("mouseup", onMouseUp)
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("selectionchange", onNativeSelectionChange)
    window.addEventListener("resize", onResize)
    return () => {
      if (settleTimer) clearTimeout(settleTimer)
      document.querySelector(SELECTION_TOOLBAR_SELECTOR)?.removeAttribute("data-selecting")
      document.removeEventListener("mouseup", onMouseUp)
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("selectionchange", onNativeSelectionChange)
      window.removeEventListener("resize", onResize)
    }
  }, [onSelectionChange, hasDraft, mobile, preserveEmptySelection, onIgnoredSelection])

  useEffect(() => {
    if (!selection) return
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Element) {
        if (target.closest(SELECTION_SURFACE_SELECTOR)) return
        const list = target.closest<HTMLElement>(".msg-list[data-list]")
        if (list && list.dataset.list !== selection.threadId) return
      }
      // 有草稿时滚动也不关气泡（尾巴会暂时离开选区，但内容不丢；
      // 提交 / 确认清空才关）
      if (hasDraft) return
      if (mobile && preserveEmptySelection) return
      if (mobile && window.getSelection()?.toString().trim()) return
      onSelectionChange(null)
    }
    document.addEventListener("scroll", onScroll, true)
    return () => document.removeEventListener("scroll", onScroll, true)
  }, [selection, onSelectionChange, hasDraft, mobile, preserveEmptySelection])
}
