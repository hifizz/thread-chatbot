"use client"
/**
 * orchestration/thread-switcher —— 会话切换 / 会话树面板，三种模式复用同一套行渲染：
 * · global（⌘K）：居中大面板，可搜索（标题 / 划选原文）、最近访问 chips、↑↓⏎ 键盘导航；
 * · column（每列 ⇄）：锚定在按钮下的小面板，点击 = 把本列切换为目标会话（swap 语义）；
 * · subtree（列头子分支按钮）：只列出以该列会话为根的整棵子树（不含根），无搜索框。
 *
 * 面板每次打开都以新 key 重挂（壳层负责），所以 query / 高亮项内部持有即可，天然归零。
 *
 * 动效外壳分两路（视觉仍是 .tc 纸面 token，见 thread-chat.css 的 .swx 段）：
 * · global 走 shadcn/ui Dialog（Base UI）：拿它的 data-starting/ending-style 过渡
 *   状态机做进出双向动画；Portal 挂到 .tc 根内保住 CSS 作用域与变量；
 * · column / subtree 是按钮旁的锚定弹层，不适合模态居中的 Dialog——保持原有
 *   fixed 定位，退场由壳层的 closing 标记 + CSS transition 完成。
 */

import React, { useEffect, useRef, useState } from "react"
import { ListTree, Search } from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Dialog, DialogPortal } from "@/components/ui/dialog"
import type { ThreadTreeState } from "../core/types"
import {
  allTreeRows,
  subtreeRows,
  threadTitle,
  type TreeRow,
} from "../core/selectors"
import { dotColorOf, dvar } from "../theme"
import type { Slot } from "./placement"

/**
 * Dialog 关闭回调的统一策略：Esc 的权威在壳层 keydown 逐层关闭链——
 * 这里取消 Dialog 内建的 Esc 关闭并放行事件冒泡（Base UI 默认会 stopPropagation），
 * 让 Esc 继续到 document 由壳层按「列表 → 气泡 → 面板 → 抽屉」的顺序处理，
 * 避免多弹层同开时一次 Esc 全部关闭 / 双触发。其余关闭原因（点外等）照常回壳层。
 */
export function dialogCloseToShell(onClose: () => void) {
  return (open: boolean, details: DialogPrimitive.Root.ChangeEventDetails) => {
    if (open) return
    if (details.reason === "escape-key") {
      details.cancel()
      details.allowPropagation()
      return
    }
    onClose()
  }
}

export type SwitcherMode =
  | { kind: "global" }
  | { kind: "column"; vpIndex: number; x: number; y: number }
  | { kind: "subtree"; rootId: string; x: number; y: number }

export interface ThreadSwitcherProps {
  state: ThreadTreeState
  mode: SwitcherMode
  /** 当前列槽（用于「锚定 / 第N列 / 细条 / 本列」状态徽标） */
  slots: Slot[]
  /** 最近访问的会话 id（global 模式的 chips） */
  recents: string[]
  /** 壳层的退场标记：true = 正在播放关闭动画（Dialog 置 open=false / local 加 .closing） */
  closing?: boolean
  /** Dialog Portal 的挂载点（.tc 根）：保证 .swx 系列选择器与纸面 CSS 变量继续生效 */
  container?: React.RefObject<HTMLElement | null>
  onPick: (row: TreeRow, mode: SwitcherMode) => void
  onClose: () => void
}

export function ThreadSwitcher({
  state,
  mode,
  slots,
  recents,
  closing = false,
  container,
  onPick,
  onClose,
}: ThreadSwitcherProps) {
  const [query, setQuery] = useState("")
  const [hi, setHi] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const isGlobal = mode.kind === "global"
  const isSubtree = mode.kind === "subtree"

  const baseRows = isSubtree
    ? subtreeRows(state, mode.rootId)
    : allTreeRows(state)
  const q = query.trim().toLowerCase()
  const filtering = q.length > 0
  const rows = !filtering
    ? baseRows
    : baseRows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.anchor ?? "").toLowerCase().includes(q)
      )

  // 键盘上下移动时让高亮行保持在可视区
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-swxrow="${hi}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [hi])

  /** 会话当前的摆放状态徽标 */
  const statusOf = (id: string): { label: string } | null => {
    if (id === "main") return { label: "锚定" }
    const i = slots.findIndex((s) => s.id === id)
    if (i < 0) return null
    return { label: slots[i].folded ? "细条" : `第 ${i + 2} 列` }
  }
  const curColId =
    mode.kind === "column" ? (slots[mode.vpIndex]?.id ?? null) : null

  const recentRows =
    isGlobal && !filtering
      ? recents.filter((id) => state.threads[id]).slice(0, 5)
      : []

  const panelClass = isGlobal ? "global" : isSubtree ? "subtree" : "local"
  const panelStyle =
    mode.kind === "global" ? undefined : { left: mode.x, top: mode.y }

  /** 面板内容（三种模式共用）；外壳按模式分别包 Dialog / 定位 div */
  const panelInner = (
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
            onChange={(e) => {
              setQuery(e.target.value)
              setHi(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setHi((h) => Math.min(h + 1, rows.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setHi((h) => Math.max(h - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                const row = rows[hi]
                if (row) onPick(row, mode)
              }
            }}
          />
          {isGlobal && <span className="kbd">⌘K</span>}
        </div>
      )}

      {recentRows.length > 0 && (
        <>
          <div className="swx-hd">最近访问</div>
          <div className="swx-recent">
            {recentRows.map((id) => {
              const rt = state.threads[id]
              return (
                <button
                  key={id}
                  className="swx-chip"
                  style={{ "--dc": dotColorOf(rt) } as React.CSSProperties}
                  onClick={() =>
                    onPick(
                      {
                        id,
                        depth: rt.depth,
                        relDepth: rt.depth,
                        isMain: false,
                        title: rt.title,
                        footnote: rt.footnote,
                        anchor: rt.anchorText,
                      },
                      mode
                    )
                  }
                >
                  <span className="dot" />
                  <span className="tt">{rt.title}</span>
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
        {rows.map((r, i) => {
          const st = statusOf(r.id)
          const isCur = curColId === r.id
          return (
            <div
              key={r.id}
              data-swxrow={i}
              className={`swx-row ${i === hi ? "hi" : ""}`}
              style={
                {
                  "--dc": r.isMain ? "#8a8377" : dvar(r.depth),
                  paddingLeft: filtering ? 9 : 9 + r.relDepth * 16,
                } as React.CSSProperties
              }
              title={r.anchor ? `划选自：「${r.anchor}」` : undefined}
              onMouseEnter={() => setHi(i)}
              onClick={() => onPick(r, mode)}
            >
              <span className="dot" />
              {r.footnote !== null && <span className="n">{r.footnote}</span>}
              <span className={`t ${r.isMain ? "main" : ""}`}>{r.title}</span>
              {r.anchor && filtering && (
                <span className="anch">「{r.anchor}」</span>
              )}
              {isCur ? (
                <span className="st">本列</span>
              ) : st ? (
                <span className="st">{st.label}</span>
              ) : mode.kind === "column" && r.isMain ? (
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
            <span>esc 关闭</span>
          </>
        ) : (
          <>
            <span>↑↓ 选择</span>
            <span>⏎ 打开</span>
            <span>esc 关闭</span>
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

  // global（⌘K）：shadcn Dialog 外壳。受控 open——closing 期间置 false 触发
  // data-ending-style 退场，Base UI 会保持 Popup 挂载到 transition 结束再卸。
  // modal=false + disablePointerDismissal 复刻旧行为：不锁页面滚动、不困焦点、
  // 点外关闭由 Backdrop 的 onMouseDown 自己接（与旧 scrim 语义逐字一致）。
  if (isGlobal) {
    return (
      <Dialog
        open={!closing}
        onOpenChange={dialogCloseToShell(onClose)}
        modal={false}
        disablePointerDismissal
      >
        <DialogPortal container={container}>
          <DialogPrimitive.Backdrop
            className="swx-scrim"
            onMouseDown={onClose}
          />
          <DialogPrimitive.Popup className="swx global">
            {panelInner}
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
    )
  }

  // column / subtree：锚定在按钮旁的小面板，保持原有 fixed 定位不进 Dialog；
  // 退场 = 壳层置 closing → CSS transition 滑向消失，到点后壳层再卸载。
  return (
    <>
      <div
        className={`swx-scrim clear ${closing ? "closing" : ""}`}
        onMouseDown={onClose}
      />
      <div
        className={`swx ${panelClass} ${closing ? "closing" : ""}`}
        style={panelStyle}
      >
        {panelInner}
      </div>
    </>
  )
}
