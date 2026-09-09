"use client"

import { useEffect, type RefObject } from "react"
import { KEYBOARD_BLUR_SETTLE_MS, VIEWPORT_SCALE_TOLERANCE } from "@/constants/thread-viewport"

/** 一个工作区统一跟随输入期间的可见视口；不对各列分别做键盘位移。 */
export function useInputViewport(rootRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const root = rootRef.current
    const viewport = window.visualViewport
    if (!enabled || !root || !viewport) return
    const touch = window.matchMedia("(any-pointer: coarse)")
    let frame = 0
    let blurTimer = 0
    let watching = false
    const isColumnInput = () => {
      const active = document.activeElement
      return active instanceof HTMLElement && root.contains(active) &&
        active.matches('.column .composer-editor[contenteditable="true"]')
    }
    const reset = () => {
      delete root.dataset.inputViewport
      root.style.removeProperty("--tc-input-height")
      root.style.removeProperty("--tc-input-top")
    }
    const update = () => {
      frame = 0
      if (!touch.matches || Math.abs(viewport.scale - 1) > VIEWPORT_SCALE_TOLERANCE) {
        reset()
        return
      }
      root.style.setProperty("--tc-input-height", `${viewport.height}px`)
      root.style.setProperty("--tc-input-top", `${viewport.offsetTop}px`)
      root.dataset.inputViewport = "true"
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const stop = () => {
      window.clearTimeout(blurTimer)
      viewport.removeEventListener("resize", schedule)
      viewport.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      cancelAnimationFrame(frame)
      frame = 0
      watching = false
      reset()
    }
    const focus = () => {
      if (!touch.matches || !isColumnInput()) return
      window.clearTimeout(blurTimer)
      if (!watching) {
        viewport.addEventListener("resize", schedule)
        viewport.addEventListener("scroll", schedule)
        window.addEventListener("resize", schedule)
        watching = true
      }
      schedule()
    }
    const blur = () => {
      window.clearTimeout(blurTimer)
      blurTimer = window.setTimeout(() => { if (!isColumnInput()) stop() }, KEYBOARD_BLUR_SETTLE_MS)
    }
    const pageShow = () => { if (isColumnInput()) focus(); else stop() }
    document.addEventListener("focusin", focus)
    document.addEventListener("focusout", blur)
    window.addEventListener("pagehide", stop)
    window.addEventListener("pageshow", pageShow)
    focus()
    return () => {
      stop()
      document.removeEventListener("focusin", focus)
      document.removeEventListener("focusout", blur)
      window.removeEventListener("pagehide", stop)
      window.removeEventListener("pageshow", pageShow)
    }
  }, [rootRef, enabled])
}
