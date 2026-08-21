"use client"

import { useSyncExternalStore } from "react"

/** 约每 430px 一列（自适应列数的换算基准）。 */
export const COL_MIN_W = 430

const subscribeResize = (notify: () => void) => {
  window.addEventListener("resize", notify)
  return () => window.removeEventListener("resize", notify)
}
const getWindowWidth = (): number | null => window.innerWidth
const getServerWindowWidth = (): number | null => null

/** SSR 用三列稳定快照；浏览器按 430px/列计算，并限制在 2–4 列。 */
export function columnCountForWidth(width: number | null): number {
  return width === null
    ? 3
    : Math.max(2, Math.min(4, Math.floor(width / COL_MIN_W)))
}

/** 响应式列容量；外部 store 的 SSR 快照为 null，避免 hydration mismatch。 */
export function useColumnViewport() {
  const windowWidth = useSyncExternalStore(
    subscribeResize,
    getWindowWidth,
    getServerWindowWidth
  )
  return {
    windowWidth,
    autoColumnCount: columnCountForWidth(windowWidth),
  }
}
