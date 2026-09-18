"use client"

import React, { useState } from "react"
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
import { useScrollMemory } from "../../scroll/use-scroll-memory"
import { ShortcutHint } from "../overlays/shortcut-hint"
import { useI18n } from "@/lib/i18n/client"


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
  const { t } = useI18n()

  const [query, setQuery] = useState("")
  const [hi, setHi] = useState(0)
  const listRef = useScrollMemory(JSON.stringify(["thread-list", mode.kind, mode.kind === "subtree" ? mode.rootId : mode.kind === "column" ? mode.vpIndex : "global", query]))

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

  function moveSelection(index: number) {
    setHi(index)
    listRef.current?.querySelector(`[data-swxrow="${index}"]`)?.scrollIntoView({ block: "nearest" })
  }

  const statusOf = (id: string): { label: string } | null => {
    if (id === "main") return { label: t("ui.pinned") }
    const index = slots.findIndex((slot) => slot.id === id)
    if (index < 0) return null
    return { label: slots[index].folded ? t("ui.strip2") : t("chat.columnNumber", { number: index + 2 }) }
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
          <ListTree size={14} />『{threadTitle(state, mode.rootId)}{t("ui.branches")}</div>
      ) : (
        <div className="swx-search">
          <Search size={14} />
          <input
            autoFocus
            value={query}
            placeholder={
              isGlobal ? t("ui.findThreadsByTitleOrSelected") : t("ui.switchThisColumnTo")
            }
            onChange={(event) => {
              setQuery(event.target.value)
              setHi(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                moveSelection(Math.min(hi + 1, rows.length - 1))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                moveSelection(Math.max(hi - 1, 0))
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
          <div className="swx-hd">{t("ui.recentlyVisited")}</div>
          <div className="swx-recent">
            {recentRows.map((id) => {
              const recentThread = state.threads[id]
              return (
                <button
                  key={id}
                  className="swx-chip tc-accent-context"
                  style={
                    {
                      "--tc-accent": dotColorOf(recentThread),
                    } as React.CSSProperties
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
              ? t("ui.noBranchesYetSelectSomeText")
              : t("chat.noMatch", { query })}
          </div>
        )}
        {rows.map((row, index) => {
          const status = statusOf(row.id)
          const isCurrent = currentColumnId === row.id
          return (
            <div
              key={row.id}
              data-swxrow={index}
              data-scroll-memory-anchor={row.id}
              className={`swx-row tc-accent-context ${index === hi ? "hi" : ""}`}
              style={
                {
                  "--tc-accent": row.isMain
                    ? "var(--tc-depth-neutral)"
                    : dvar(row.depth),
                  paddingLeft: filtering ? 9 : 9 + row.relDepth * 16,
                } as React.CSSProperties
              }
              title={row.anchor ? t("chat.selectedQuote", { quote: row.anchor }) : undefined}
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
                <span className="st">{t("ui.thisColumn")}</span>
              ) : status ? (
                <span className="st">{status.label}</span>
              ) : mode.kind === "column" && row.isMain ? (
                <span className="st">{t("ui.collapseThisColumn2")}</span>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="swx-foot">
        {isSubtree ? (
          <>
            <span>{t("ui.clickARowToOpenThe")}</span>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.closeDialog} /> {t("common.close")}</span>
          </>
        ) : (
          <>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.moveSelection} /> {t("ui.select")}</span>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.openSelection} /> {t("ui.open")}</span>
            <span>
              <ShortcutHint {...THREAD_CHAT_SHORTCUTS.closeDialog} /> {t("common.close")}</span>
            {isGlobal ? (
              <span>{t("ui.clickToPlaceAutomaticallyUsingThe")}</span>
            ) : (
              <span>{t("ui.clickToOpenInThisColumn")}</span>
            )}
          </>
        )}
      </div>
    </>
  )
}
