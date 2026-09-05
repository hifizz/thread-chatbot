"use client"

import { useEffect, useId, useRef, useState, type CSSProperties } from "react"
import {
  USER_MESSAGE_COLLAPSED_LINES,
  USER_MESSAGE_EXPAND_LABELS,
} from "@/constants/user-message"
import type { ConversationViewMessage } from "../../core/types"
import { UIMessageSupplementalParts } from "./ui-message-parts"

/** 只折叠展示，不裁剪消息原文；按钮始终位于内部滚动区之外。 */
export function UserMessageContent({ message }: { message: ConversationViewMessage }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const contentId = useId()
  const isExpanded = expanded && overflowing

  useEffect(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport) return

    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(viewport).lineHeight)
      const overflows = content.scrollHeight > Math.ceil(lineHeight * USER_MESSAGE_COLLAPSED_LINES)
      setOverflowing(overflows)
      if (!overflows) {
        setExpanded(false)
        viewport.scrollTop = 0
      }
    }
    // 观察未被限高的正文：同时覆盖拖动列宽、字体变化和附件加载。
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div
        id={contentId}
        ref={viewportRef}
        className="user-message-viewport"
        data-expanded={isExpanded}
        tabIndex={isExpanded ? 0 : undefined}
        style={{ "--tc-user-message-collapsed-lines": USER_MESSAGE_COLLAPSED_LINES } as CSSProperties}
      >
        <div ref={contentRef} className="user-message-content">
          {message.quote && <div className="msg-quote">{message.quote.text}</div>}
          {message.text}
          <UIMessageSupplementalParts message={message} />
        </div>
      </div>
      {overflowing && (
        <button
          type="button"
          className="user-message-toggle"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          onClick={() => {
            if (viewportRef.current) viewportRef.current.scrollTop = 0
            setExpanded(!isExpanded)
          }}
        >
          {isExpanded ? USER_MESSAGE_EXPAND_LABELS.less : USER_MESSAGE_EXPAND_LABELS.more}
        </button>
      )}
    </>
  )
}
