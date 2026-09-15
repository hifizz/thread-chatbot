"use client"

import { useLayoutEffect } from "react"
import { QUESTION_HIGHLIGHT_NAME } from "@/constants/question-highlight"
import { locateAnchor } from "./text-anchor"
import { getSelectionRoot, type SelectionInfo } from "./use-assistant-text-selection"

/** 临时高亮独立于原生 Selection；聚焦输入框后仍保留，关闭时整体释放。 */
export function useQuestionHighlight(selection: SelectionInfo | null, open: boolean) {
  useLayoutEffect(() => {
    const root = selection ? getSelectionRoot(selection) : undefined
    if (!open || !selection || !root || typeof CSS === "undefined"
      || !CSS.highlights || typeof Highlight === "undefined") return

    // Lightning CSS 暂不能解析 ::highlight()（上游 #1300）。交给浏览器解析，
    // 样式与临时 Highlight 同生命周期；颜色仍取样式层的主题 token。
    const style = document.createElement("style")
    style.textContent = `.tc ::highlight(${QUESTION_HIGHLIGHT_NAME}) { background-color: var(--tc-question-highlight); }`
    document.head.append(style)
    const highlight = new Highlight()
    const update = () => {
      highlight.clear()
      if (!root.isConnected) return
      // 复用现有锚点，避免 Markdown 重绘后 Range 指向旧文字节点。
      const located = locateAnchor(root, selection.anchor, { fuzzyThreshold: 1 })
      if (located) highlight.add(located.range)
    }
    update()
    CSS.highlights.set(QUESTION_HIGHLIGHT_NAME, highlight)
    const observer = new MutationObserver(update)
    observer.observe(root, { childList: true, characterData: true, subtree: true })
    return () => {
      observer.disconnect()
      style.remove()
      if (CSS.highlights.get(QUESTION_HIGHLIGHT_NAME) === highlight)
        CSS.highlights.delete(QUESTION_HIGHLIGHT_NAME)
    }
  }, [selection, open])
}
