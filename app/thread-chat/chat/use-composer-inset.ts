"use client"

import { useLayoutEffect, useRef } from "react"

/** 列内浮动输入区的实际占高；只更新本列 CSS，不重渲染消息。 */
export function useComposerInset() {
  const rootRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    const dock = dockRef.current
    if (!root || !dock) return
    const update = () => {
      root.style.setProperty("--tc-composer-inset", `${dock.offsetHeight}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(dock)
    return () => {
      observer.disconnect()
      root.style.removeProperty("--tc-composer-inset")
    }
  }, [])
  return { rootRef, dockRef }
}
