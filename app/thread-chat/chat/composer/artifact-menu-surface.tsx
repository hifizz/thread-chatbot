"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { positionArtifactMenu } from "@/lib/thread-chat/artifact-menu-position"

/** 保留 Lexical 的键盘/选项协议，仅接管浮层几何与滚动边界。 */
export function ArtifactMenuSurface({ children }: { children: ReactNode }) {
  const [editor] = useLexicalComposerContext()
  const listRef = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    const root = editor.getRootElement()
    const win = root?.ownerDocument.defaultView
    if (!list || !root || !win) return
    let frame = 0
    let previous = ""
    const position = () => {
      const selection = win.getSelection()
      if (selection?.rangeCount && root.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0).cloneRange()
        range.collapse(false)
        const caret = range.getBoundingClientRect()
        const editorBounds = root.getBoundingClientRect()
        const viewport = win.visualViewport
        const bounds = {
          left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
          width: viewport?.width ?? root.ownerDocument.documentElement.clientWidth,
          height: viewport?.height ?? win.innerHeight,
        }
        // scrollHeight 不含边框；从实际盒模型取差值，避免高度预算漏算边框。
        const border = list.offsetHeight - list.clientHeight
        const next = positionArtifactMenu(caret, bounds, list.scrollHeight + border)
        const signature = JSON.stringify(next)
        if (signature !== previous) {
          previous = signature
          list.style.left = `${next.left}px`
          list.style.top = `${next.top}px`
          list.style.width = `${next.width}px`
          list.style.maxHeight = `${next.maxHeight}px`
          list.dataset.side = next.side
        }
        const visible = caret.height > 0 && caret.bottom > editorBounds.top && caret.top < editorBounds.bottom
          && caret.bottom > bounds.top && caret.top < bounds.top + bounds.height
          && caret.left >= bounds.left && caret.left <= bounds.left + bounds.width
        list.style.visibility = visible ? "visible" : "hidden"
      } else {
        list.style.visibility = "hidden"
      }
      // 菜单打开期间跟随画布 transform、光标、滚动和软键盘；关闭即停止。
      frame = win.requestAnimationFrame(position)
    }
    position()
    return () => win.cancelAnimationFrame(frame)
  }, [editor])
  return <div className="tc artifact-reference-menu-root">
    <ul ref={listRef} className="artifact-reference-menu" role="listbox" aria-label="引用项目 Artifact">
      {children}
    </ul>
  </div>
}
