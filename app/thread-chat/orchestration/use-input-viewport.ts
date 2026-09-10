"use client"

import { useEffect, type RefObject } from "react"
import { VIEWPORT_SETTLE_MS, VIEWPORT_SCALE_TOLERANCE } from "@/constants/thread-viewport"

/** 移动端工作区跟随可见视口，包含键盘、浏览器工具栏及页面唤醒。 */
export function useInputViewport(rootRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const root = rootRef.current
    const viewport = window.visualViewport
    if (!enabled || !root || !viewport) return
    const touch = window.matchMedia("(any-pointer: coarse)")
    let frame = 0
    let settleTimer = 0
    let suspended = document.visibilityState === "hidden"
    const reset = () => {
      delete root.dataset.inputViewport
      root.style.removeProperty("--tc-input-height")
      root.style.removeProperty("--tc-input-top")
    }
    const update = () => {
      frame = 0
      if (suspended || document.visibilityState === "hidden" || !touch.matches ||
        Math.abs(viewport.scale - 1) > VIEWPORT_SCALE_TOLERANCE || viewport.height <= 0) {
        reset()
        return
      }
      root.style.setProperty("--tc-input-height", `${viewport.height}px`)
      root.style.setProperty("--tc-input-top", `${viewport.offsetTop}px`)
      root.dataset.inputViewport = "true"
    }
    const schedule = () => {
      if (!suspended && document.visibilityState !== "hidden" && !frame) {
        frame = requestAnimationFrame(update)
      }
    }
    const suspend = () => {
      suspended = true
      window.clearTimeout(settleTimer)
      cancelAnimationFrame(frame)
      frame = 0
      reset()
    }
    // 恢复瞬间可能仍读到旧尺寸；动画结束后再读一次，不依赖浏览器补发 resize。
    const settle = () => {
      window.clearTimeout(settleTimer)
      if (suspended || document.visibilityState === "hidden") return
      schedule()
      settleTimer = window.setTimeout(schedule, VIEWPORT_SETTLE_MS)
    }
    const resume = () => {
      suspend()
      suspended = document.visibilityState === "hidden"
      settle()
    }
    const visibilityChange = () => {
      if (document.visibilityState === "hidden") suspend()
      else resume()
    }
    viewport.addEventListener("resize", schedule)
    viewport.addEventListener("scroll", schedule)
    window.addEventListener("resize", schedule)
    touch.addEventListener("change", schedule)
    document.addEventListener("focusin", settle)
    document.addEventListener("focusout", settle)
    document.addEventListener("visibilitychange", visibilityChange)
    window.addEventListener("pagehide", suspend)
    window.addEventListener("pageshow", resume)
    settle()
    return () => {
      suspend()
      viewport.removeEventListener("resize", schedule)
      viewport.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      touch.removeEventListener("change", schedule)
      document.removeEventListener("focusin", settle)
      document.removeEventListener("focusout", settle)
      document.removeEventListener("visibilitychange", visibilityChange)
      window.removeEventListener("pagehide", suspend)
      window.removeEventListener("pageshow", resume)
    }
  }, [rootRef, enabled])
}
