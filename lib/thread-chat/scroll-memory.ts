import {
  SCROLL_MEMORY_KEY,
  SCROLL_MEMORY_LIMIT,
  SCROLL_SAVE_INTERVAL_MS,
} from "../../constants/scroll-restoration"

export interface ScrollPosition {
  top: number
  left: number
  atEnd: boolean
  anchor?: string
  offset?: number
}

function readEntries(): [string, ScrollPosition][] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SCROLL_MEMORY_KEY) ?? "[]")
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is [string, ScrollPosition] => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") return false
      const p = entry[1]
      return p && Number.isFinite(p.top) && p.top >= 0 &&
        Number.isFinite(p.left) && typeof p.atEnd === "boolean" &&
        (p.anchor === undefined || typeof p.anchor === "string") &&
        (p.offset === undefined || Number.isFinite(p.offset))
    }).slice(-SCROLL_MEMORY_LIMIT)
  } catch {
    return []
  }
}

export function loadScrollPosition(key: string): ScrollPosition | undefined {
  return new Map(readEntries()).get(key)
}

export function saveScrollPosition(key: string, position: ScrollPosition): void {
  try {
    const entries = new Map(readEntries())
    entries.delete(key)
    entries.set(key, position)
    localStorage.setItem(SCROLL_MEMORY_KEY, JSON.stringify([...entries].slice(-SCROLL_MEMORY_LIMIT)))
  } catch {
    // 浏览器禁用存储或空间已满时，不影响阅读和导航。
  }
}

/** 固定窗口节流；窗口内替换末值，flush 用于卸载和页面离开。 */
export function createScrollWriter(write: (position: ScrollPosition) => void) {
  let pending: (() => ScrollPosition) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (pending) {
      write(pending())
      pending = undefined
    }
  }
  return {
    push(readPosition: () => ScrollPosition) {
      pending = readPosition
      if (timer === undefined) timer = setTimeout(flush, SCROLL_SAVE_INTERVAL_MS)
    },
    flush,
  }
}
