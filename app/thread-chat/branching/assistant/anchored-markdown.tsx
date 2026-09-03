"use client"

import React, { useCallback, useEffect, useReducer, useRef } from "react"
import type { Message, ThreadTreeState } from "../../core/types"
import { threadTitle } from "../../core/selectors"
import { dc, dvar } from "../../theme"
import { MarkdownBody } from "../../chat/message/markdown-body"
import { useSmoothText } from "../../chat/message/smooth-text"
import {
  clearHighlights,
  locateAnchor,
  paintRange,
} from "../selection/text-anchor"

/**
 * Markdown 正文 + 渲染后锚点高亮/脚注。
 *
 * 锚点定位发生在 Markdown 渲染后的真实 DOM 上；流式阶段仅呈现平滑文本，
 * 内容稳定后才绘制非 React 管理的高亮节点，避免与代码高亮 commit 竞争。
 */
export function AnchoredMarkdown({
  state,
  msg,
  onOpenThread,
  source,
  insertAt,
  insert,
}: {
  state: ThreadTreeState
  msg: Message
  onOpenThread: (targetId: string, opts?: { keepSource?: boolean }) => void
  /** default 渲染完整消息正文；parts 渲染器可传入单个 text part 的内容。 */
  source?: string
  /** 在流事件记录的正文字符偏移处插入工具活动；缺省时渲染普通单段 Markdown。 */
  insertAt?: number
  insert?: React.ReactNode
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // forksKey 只随 fork 的增删与编号变化——source 未变、仅新增 fork 时也能触发重绘
  const forksKey = msg.forks
    .map((fork) => `${fork.threadId}:${fork.num}`)
    .join("|")
  const active = msg.status === "streaming" || msg.status === "pending"
  const markdownSource = source ?? msg.text
  const display = useSmoothText(markdownSource, active)
  const renderedSource = active ? display : markdownSource
  const [settledRevision, bumpSettledRevision] = useReducer(
    (revision: number) => revision + 1,
    0
  )
  const onContentSettled = useCallback(() => {
    bumpSettledRevision()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const markdownBodies = [...host.querySelectorAll<HTMLElement>(".md-body")]
    if (markdownBodies.length === 0) return

    const wipe = () => {
      markdownBodies.forEach((markdownBody) => {
        clearHighlights(markdownBody)
        markdownBody
          .querySelectorAll("sup.fn-mark")
          .forEach((node) => node.remove())
      })
    }
    wipe()

    // 高亮仍在飞或当前是流式 plaintext 时，绝不手改 React 即将 reconcile 的代码 DOM。
    if (
      active ||
      markdownBodies.some(
        (markdownBody) => markdownBody.dataset.contentSettled !== "true"
      )
    )
      return wipe

    for (const fork of msg.forks) {
      if (!fork.anchor) continue
      let markdownBody: HTMLElement | null = null
      let located: ReturnType<typeof locateAnchor> = null
      for (const candidate of markdownBodies) {
        located = locateAnchor(candidate, fork.anchor)
        if (located) {
          markdownBody = candidate
          break
        }
      }
      if (!markdownBody || !located) continue
      // 高亮底色统一走 CSS 派生 token（--tc-fc-mark 内做 20% 混色），
      // 这里只注入 fork 深度的 contextual 变量（与 marks 的 fc-N 类同源）
      paintRange(located.range, fork.threadId, "var(--tc-fc-mark)", {
        "--fc": dvar(fork.depth),
      })

      const marks = markdownBody.querySelectorAll<HTMLElement>(
        `[data-text-anchor-mark="${cssEscape(fork.threadId)}"]`
      )
      marks.forEach((mark) => {
        mark.setAttribute("data-fork-id", fork.threadId)
        mark.classList.add("anchored-mark", `fc-${dc(fork.depth)}`)
        mark.title = `分支「${threadTitle(state, fork.threadId)}」· 点击打开 · ⌘点击保留本列在右侧打开`
      })

      const last = marks[marks.length - 1]
      if (last) {
        const footnote = document.createElement("sup")
        footnote.className = `fn-mark fc-${dc(fork.depth)}`
        footnote.setAttribute("data-fork-id", fork.threadId)
        footnote.textContent = String(fork.num)
        last.after(footnote)
      }
    }

    return wipe
    // state 仅用于 title 文案，不参与重绘时机；有意省略以免每次 version 变动都重绘
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, msg.text, forksKey, settledRevision])

  const onClick = (event: React.MouseEvent) => {
    const element = (event.target as HTMLElement).closest?.("[data-fork-id]")
    if (!element) return
    const threadId = element.getAttribute("data-fork-id")
    if (!threadId) return
    onOpenThread(threadId, {
      keepSource: event.metaKey || event.ctrlKey,
    })
  }

  const normalizedInsertAt =
    insertAt == null
      ? null
      : Math.max(0, Math.min(insertAt, markdownSource.length))
  const insertIsVisible =
    insert != null &&
    normalizedInsertAt != null &&
    renderedSource.length >= normalizedInsertAt
  const beforeInsert = insertIsVisible
    ? renderedSource.slice(0, normalizedInsertAt)
    : renderedSource
  const afterInsert = insertIsVisible
    ? renderedSource.slice(normalizedInsertAt)
    : ""

  return (
    <div ref={hostRef} onClick={onClick}>
      {beforeInsert ? (
        <MarkdownBody
          source={beforeInsert}
          streaming={active}
          onContentSettled={onContentSettled}
        />
      ) : null}
      {insertIsVisible ? insert : null}
      {afterInsert ? (
        <MarkdownBody
          source={afterInsert}
          streaming={active}
          onContentSettled={onContentSettled}
        />
      ) : null}
    </div>
  )
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value)
  return value.replace(/"/g, '\\"')
}
