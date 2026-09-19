"use client"

/**
 * demo/artifact-picker —— @ 引用弹层的演示版。
 * 外观对齐真实 ComposerMenu 列表（图标 + 标题 +「Markdown · 来源」副行）；
 * 支持 ↑/↓、Enter、Escape 与鼠标点选。
 */

import { FileTextIcon } from "lucide-react"
import { useEffect, useRef, useState, type ReactElement } from "react"

import type { DemoArtifact } from "@/constants/landing-demo"

interface Props {
  items: DemoArtifact[]
  onPick: (item: DemoArtifact) => void
  onClose: () => void
}

export function ArtifactPicker({ items, onPick, onClose }: Props): ReactElement {
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
    /* 卸载（Esc 或点选）时把焦点还给 composer 输入框 */
    return () => {
      document
        .querySelector<HTMLElement>(".ld [data-cursor-target='composer']")
        ?.focus()
    }
  }, [])

  return (
    <div
      ref={ref}
      className="ld-picker"
      role="listbox"
      aria-label="引用资源"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setActive((i) => Math.min(i + 1, items.length - 1))
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          setActive((i) => Math.max(i - 1, 0))
        } else if (e.key === "Enter") {
          e.preventDefault()
          onPick(items[active])
        } else if (e.key === "Escape") {
          e.preventDefault()
          onClose()
        }
      }}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={active === i}
          className={`ld-picker-item${active === i ? " active" : ""}`}
          data-cursor-target={`picker-item-${i}`}
          tabIndex={-1}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(item)}
        >
          <FileTextIcon className="ld-picker-icon" aria-hidden />
          <span className="ld-picker-text">
            <span className="ld-picker-title">{item.title}</span>
            <span className="ld-picker-sub">{item.kind}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
