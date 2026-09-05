"use client"

import React, { useEffect, useRef, useState } from "react"
import { ListTree, Search } from "lucide-react"
import { THREAD_CHAT_SHORTCUTS } from "@/constants/thread-chat"
import type { ThreadTreeState } from "../../core/types"
import {
  allTreeRows,
  subtreeRows,
  threadTitle,
  type TreeRow,
} from "../../core/selectors"
import { dotColorOf, dvar } from "../../theme"
import type { Slot } from "../columns/placement"
import { ShortcutHint } from "../overlays/shortcut-hint"

export type SwitcherMode =
  | { kind: "global" }
  | { kind: "column"; vpIndex: number; x: number; y: number }
  | { kind: "subtree"; rootId: string; x: number; y: number }

export interface ThreadSwitcherPanelProps {
  state: ThreadTreeState
  mode: SwitcherMode
  slots: Slot[]
  recents: string[]
  onPick: (row: TreeRow, mode: SwitcherMode) => void
}

/** 三种 switcher shell 共用的搜索、最近访问、树行和键盘选择能力。 */
export function ThreadSwitcherPanel({
  state,
  mode,
  slots,
  recents,
  onPick,
}: ThreadSwitcherPanelProps) {
  const [query, setQuery] = useState("")
  const [hi, setHi] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const isGlobal = mode.kind === "global"
  const isSubtree = mode.kind === "subtree"
  const baseRows = isSubtree
    ? subtreeRows(state, mode.rootId)
    : allTreeRows(state)
  const normalizedQuery = query.trim().toLowerCase()
  const filtering = normalizedQuery.length > 0
  const rows = !filtering
    ? baseRows
    : baseRows.filter(
        (row) =>
          row.title.toLowerCase().includes(normalizedQuery) ||
          (row.anchor ?? "").toLowerCase().includes(normalizedQuery)
      )

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-swxrow="${hi}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [hi])

  const statusOf = (id: string): { label: string } | null => {
    if (id === "main") return { label: "锚定" }
    const index = slots.findIndex((slot) => slot.id === id)
    if (index < 0) return null
    return { label: slots[index].folded ? "细条" : `第 ${index + 2} 列` }
  }
  const currentColumnId =
    mode.kind === "column" ? (slots[mode.vpIndex]?.id ?? null) : null
  const recentRows =
    isGlobal && !filtering
      ? recents.filter((id) => state.threads[id]).slice(0, 5)
      : []

  return (
    <>
      {isSubtree ? (
        <div className="swx-title">
          <ListTree size={14} />『{threadTitle(state, mode.rootId)}』的子分支
        </div>
      ) : (
        <div className="swx-search">
          <Search size={14} />
          <input
            autoFocus
            value={query}
            placeholder={
              isGlobal ? "搜索会话（标题 / 划选原文）…" : "把本列切换为…"
            }
            onChange={(event) => {
              setQuery(event.target.value)
              setHi(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setHi((current) => Math.min(current + 1, rows.length - 1))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                setHi((current) => Math.max(current - 1, 0))
              } else if (event.key === "Enter") {
                event.preventDefault()
                const row = rows[hi]
                if (row) onPick(row, mode)
              }
            }}
          />
          {isGlobal && (
            <ShortcutHint {...THREAD_CHAT_SHORTCUTS.openThreadTree} />
          )}
        </div>
      )}

      {recentRows.length > 0 && (
        <>
          <div className="swx-hd">最近访问</div>
          <div className="swx-recent">
            {recentRows.map((id) => {
              const recentThread = state.threads[id]
              return (
                <button
                  key={id}
                  className="swx-chip"
                  style={
                    { "--dc": dotColorOf(recentThread) } as React.CSSProperties
                  }
                  onClick={() =>
                    onPick(
                      {
                        id,
                        depth: recentThread.depth,
                        relDepth: recentThread.depth,
                        isMain: false,
                        title: recentThread.title,
                        footnote: recentThread.footnote,
                        anchor: recentThread.anchorText,
                      },
                      mode
                    )
                  }
                >
                  <span className="dot" />
                  <span className="tt">{recentThread.title}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="swx-list" ref={listRef}>
        {rows.length === 0 && (
          <div className="swx-empty">
            {isSubtree
              ? "此会话还没有子分支——划选一段文字即可开出第一个"
              : `没有匹配「${query}」的会话`}
          </div>
        )}
        {rows.map((row, index) => {
          const status = statusOf(row.id)
          const isCurrent = currentColumnId === row.id
          return (
            <div
              key={row.id}
              data-swxrow={index}
              className={`swx-row ${index === hi ? "hi" : ""}`}
              style={
                {
                  "--dc": row.isMain
                    ? "var(--thread-neutral)"
                    : dvar(row.depth),
                  paddingLeft: filtering ? 9 : 9 + row.relDepth * 16,
                } as React.CSSProperties
              }
              title={row.anchor ? `划选自：「${row.anchor}」` : undefined}
              onMouseEnter={() => setHi(index)}
              onClick={() => onPick(row, mode)}
            >
              <span className="dot" />
              {row.footnote !== null && (
                <span className="n">{row.footnote}</span>
              )}
              <span className={`t ${row.isMain ? "main" : ""}`}>
                {row.title}
              </span>
              {row.anchor && filtering && (
                <span className="anch">「{row.anchor}」</span>
              )}
              {isCurrent ? (
                <span className="st">本列</span>
              ) : status ? (
                <span className="st">{status.label}</span>
              ) : mode.kind === "column" && row.isMain ? (
                <span className="st">⇐ 收起本列</span>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="swx-foot">
        {isSubtree ? (
          <>
            <span>点击行打开（列满走当前策略）</span>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.closeDialog} /> 关闭
            </span>
          </>
        ) : (
          <>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.moveSelection} /> 选择
            </span>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.openSelection} /> 打开
            </span>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.closeDialog} /> 关闭
            </span>
            {isGlobal ? (
              <span>点击 = 智能放置（列满走当前策略）</span>
            ) : (
              <span>点击 = 在本列打开</span>
            )}
          </>
        )}
      </div>
    </>
  )
}
