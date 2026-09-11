"use client"

import { createContext, useContext, useLayoutEffect, useRef } from "react"
import { restoreScrollPosition } from "@/lib/thread-chat/restore-scroll-position"

/** 由工作区提供作用域，避免不同项目的 main / 同名列表相互覆盖。 */
export const ScrollMemoryScope = createContext<string | null>(null)

export function useScrollMemory(
  id: string,
  { ready = true, followEnd = false, initialize }: {
    ready?: boolean
    followEnd?: boolean
    initialize?: (atEnd: boolean) => void
  } = {}
) {
  const scope = useContext(ScrollMemoryScope)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const viewport = ref.current
    if (!viewport || !ready) return
    // 独立展示 ChatView 的页面仍保持原有默认贴底行为。
    if (!scope) {
      initialize?.(followEnd)
      return
    }
    const key = JSON.stringify([scope, id])
    return restoreScrollPosition(viewport, key, followEnd, initialize)
  }, [scope, id, ready, followEnd, initialize])
  return ref
}
