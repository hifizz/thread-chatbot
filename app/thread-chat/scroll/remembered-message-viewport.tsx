"use client"

import React, { useCallback } from "react"
import { MessageScroller, useMessageScroller } from "@shadcn/react/message-scroller"
import { useScrollMemory } from "./use-scroll-memory"

export function RememberedViewport({ threadId, children }: { threadId: string; children: React.ReactNode }) {
  const { scrollToStart, scrollToEnd } = useMessageScroller()
  const initialize = useCallback((atEnd: boolean) => {
    if (atEnd) scrollToEnd({ behavior: "instant" })
    else scrollToStart({ behavior: "instant" })
  }, [scrollToStart, scrollToEnd])
  const ref = useScrollMemory(`thread:${threadId}`, { followEnd: true, initialize })
  return <MessageScroller.Viewport ref={ref} className="msg-list" data-list={threadId}>{children}</MessageScroller.Viewport>
}

