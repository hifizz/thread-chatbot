import {
  SCROLL_ANCHOR_ATTRIBUTE,
  SCROLL_EDGE_THRESHOLD,
  SCROLL_RESTORE_WINDOW_MS,
} from "../../constants/scroll-restoration"
import { createScrollWriter, loadScrollPosition, saveScrollPosition } from "./scroll-memory"


/** 挂载一次滚动容器；返回清理函数。DOM 行为与 React 生命周期分开，便于回归验证。 */
export function restoreScrollPosition(
  viewport: HTMLDivElement,
  key: string,
  followEnd: boolean,
  initialize?: (atEnd: boolean) => void
) {
  const saved = loadScrollPosition(key)
  initialize?.(saved ? followEnd && saved.atEnd : followEnd)
  let restoring = !!saved
  let disposed = false
  let frame = 0
  let expectedTop = viewport.scrollTop
  const writer = createScrollWriter((position) => saveScrollPosition(key, position))
  const anchors = () => Array.from(viewport.querySelectorAll<HTMLElement>(`[${SCROLL_ANCHOR_ATTRIBUTE}]`))
  const capture = () => {
    if (restoring || viewport.clientHeight === 0) return
    writer.push(() => {
      const top = viewport.getBoundingClientRect().top
      const anchor = anchors().find((element) => element.getBoundingClientRect().bottom > top)
      return {
        top: Math.max(0, viewport.scrollTop),
        left: viewport.scrollLeft,
        atEnd: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= SCROLL_EDGE_THRESHOLD,
        ...(anchor ? {
          anchor: anchor.getAttribute(SCROLL_ANCHOR_ATTRIBUTE)!,
          offset: anchor.getBoundingClientRect().top - top,
        } : {}),
      }
    })
  }
  const restore = () => {
    if (!restoring || !saved || disposed || viewport.clientHeight === 0) return
    const anchor = saved.anchor && anchors().find((element) => element.getAttribute(SCROLL_ANCHOR_ATTRIBUTE) === saved.anchor)
    const target = followEnd && saved.atEnd
      ? viewport.scrollHeight - viewport.clientHeight
      : anchor && saved.offset !== undefined
        ? viewport.scrollTop + anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset
        : saved.top
    viewport.scrollTop = Math.max(0, target)
    viewport.scrollLeft = saved.left
    expectedTop = viewport.scrollTop
  }
  restore()
  // 等待图片、字体、输入框高度及异步列表布局稳定；用户一操作就交还控制。
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(restore)
  })
  observer.observe(viewport)
  if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
  const stopRestoring = () => {
    restoring = false
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
  const onScroll = () => {
    // 搜索结果定位、滚到底按钮等显式跳转也优先于恢复。
    if (restoring && Math.abs(viewport.scrollTop - expectedTop) > 1) stopRestoring()
    capture()
  }
  const timer = window.setTimeout(() => {
    restore()
    stopRestoring()
    capture()
  }, SCROLL_RESTORE_WINDOW_MS)
  const flush = () => { capture(); writer.flush() }
  const onVisibility = () => { if (document.visibilityState === "hidden") flush() }
  const onKey = (event: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stopRestoring()
  }
  viewport.addEventListener("scroll", onScroll, { passive: true })
  viewport.addEventListener("wheel", stopRestoring, { passive: true })
  viewport.addEventListener("touchstart", stopRestoring, { passive: true })
  viewport.addEventListener("pointerdown", stopRestoring)
  viewport.addEventListener("keydown", onKey)
  window.addEventListener("pagehide", flush)
  document.addEventListener("visibilitychange", onVisibility)
  return () => {
    // layout effect 清理时 DOM 尚未拆除，读取的仍是离开前最后位置。
    flush()
    disposed = true
    stopRestoring()
    clearTimeout(timer)
    viewport.removeEventListener("scroll", onScroll)
    viewport.removeEventListener("wheel", stopRestoring)
    viewport.removeEventListener("touchstart", stopRestoring)
    viewport.removeEventListener("pointerdown", stopRestoring)
    viewport.removeEventListener("keydown", onKey)
    window.removeEventListener("pagehide", flush)
    document.removeEventListener("visibilitychange", onVisibility)
  }
}
