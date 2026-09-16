"use client"

/**
 * demo/demo-cursor —— 模拟指针：测量 data-cursor-target 元素，
 * 在演示根容器内滑动过去。挂在 mockup 最外层，顶栏与分栏都可达。
 */

import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react"

interface Props {
  rootRef: RefObject<HTMLElement | null>
  target?: string
}

export function DemoCursor({ rootRef, target }: Props): ReactElement | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!target) return
    const root = rootRef.current
    if (!root) return
    let tries = 0
    const measure = () => {
      const el = root.querySelector<HTMLElement>(
        `[data-cursor-target="${target}"]`,
      )
      if (!el) {
        if (tries++ < 16) rafRef.current = requestAnimationFrame(measure)
        return
      }
      const cr = root.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      setPos({ x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 })
    }
    rafRef.current = requestAnimationFrame(measure)
    /* 目标可能随流式文本移动，低频复测。 */
    const id = window.setInterval(measure, 400)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.clearInterval(id)
    }
  }, [target, rootRef])

  if (!target || !pos) return null
  return (
    <svg
      className="ld-cursor"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden
    >
      <path
        d="M4 2 L14 9 L9.5 9.8 L12 14.5 L10 15.5 L7.6 10.8 L4 13.5 Z"
        fill="currentColor"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
