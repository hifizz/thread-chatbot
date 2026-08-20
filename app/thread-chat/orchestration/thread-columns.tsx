"use client"
/**
 * orchestration/thread-columns —— 列容器与列槽编排。
 *
 * 职责边界：会话树归 core store；「哪些会话摆在哪些列、谁折叠成细条」这类
 * 视口状态归这里的 React state（useColumnSlots）。列内长什么样由上层通过
 * renderThread 渲染插槽决定（本层不认识 chat / 分支装饰）。
 *
 * 列宽模型（fill）：列行永远铺满容器。自动列 flex:1 1 0；显式调宽的列以
 * flex-basis 承载宽度（flex:1 1 <px>，grow/shrink 保留），容器变化时全行
 * 吸收差值，不产生两侧 gutter。commit 以整行为单位（basis 总和 == 容器时
 * flex 解算逐列等于所存宽度，所见即所存），见 use-column-resize 头注。
 */

import React from "react"
import type { Thread, ThreadTreeState } from "../core/types"
import { accentOf } from "../theme"
import type { Slot } from "./placement"
import { useColumnResize, type ColumnResizeHandlers } from "./use-column-resize"

/* ---------------- 列容器组件 ---------------- */

function ColumnShell({
  thread,
  flashing,
  width,
  children,
}: {
  thread: Thread
  flashing: boolean
  /** 显式列宽（px）：有值则以 flex-basis 承载（flex:1 1 <px>，grow/shrink 保留，
      行永远铺满容器），无值走自动均分（CSS flex:1 1 0）。下限仍由 CSS min-width 兜底 */
  width?: number
  children: React.ReactNode
}) {
  const isMain = thread.id === "main"
  return (
    <div
      className={`column ${isMain ? "main" : "branch"} ${flashing ? "flash" : ""}`}
      data-thread-id={thread.id}
      style={
        {
          "--accent": accentOf(thread),
          ...(width !== undefined ? { flex: `1 1 ${width}px` } : null),
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}

/** 相邻两个展开列之间的可拖拽分割线（任一侧是细条则不渲染，见 ThreadColumns） */
function ColumnResizer({
  leftId,
  rightId,
  label,
  rz,
}: {
  leftId: string
  rightId: string
  label: string
  rz: ColumnResizeHandlers
}) {
  return (
    <div
      className="col-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="拖动调整两侧列宽 · 双击恢复均分（聚焦后 ←/→ 微调）"
      tabIndex={0}
      onPointerDown={(e) => rz.onPointerDown(e, leftId, rightId)}
      onPointerMove={rz.onPointerMove}
      onPointerUp={rz.onPointerUp}
      onPointerCancel={rz.onPointerCancel}
      onDoubleClick={rz.onDoubleClick}
      onKeyDown={(e) => rz.onKeyDown(e, leftId, rightId)}
    />
  )
}

/** 方案⑤的竖直细条：深度色左缘 + 竖排标题 + 脚注号徽章，点击原地展开 */
function FoldedStrip({
  thread,
  onClick,
}: {
  thread: Thread
  onClick: () => void
}) {
  return (
    <button
      className="col-strip"
      data-thread-id={thread.id}
      style={{ "--accent": accentOf(thread) } as React.CSSProperties}
      title={`「${thread.title}」已折叠为细条 · 点击原地展开`}
      onClick={onClick}
    >
      {thread.footnote !== null && (
        <span className="fn">{thread.footnote}</span>
      )}
      <span className="vt">{thread.title}</span>
    </button>
  )
}

export interface ThreadColumnsProps {
  state: ThreadTreeState
  slots: Slot[]
  /** 显式列宽映射（useColumnSlots.widths），无条目的列自动均分 */
  widths: Record<string, number>
  flashId: string | null
  colsRef: React.RefObject<HTMLDivElement | null>
  /** 渲染一列的内部内容（主线 vpIndex = -1；分支列为槽位下标） */
  renderThread: (threadId: string, vpIndex: number) => React.ReactNode
  /** 点击细条（上层走统一的 openThread 意图入口） */
  onExpandStrip: (id: string) => void
  /** 拖拽末帧 / 键盘步进：整行合并写入各列的显式宽度 */
  onCommitWidths: (patch: Record<string, number>) => void
  /** 双击分割线：删除整行的显式宽度（恢复自动均分） */
  onResetWidths: (ids: string[]) => void
}

export function ThreadColumns({
  state,
  slots,
  widths,
  flashId,
  colsRef,
  renderThread,
  onExpandStrip,
  onCommitWidths,
  onResetWidths,
}: ThreadColumnsProps) {
  const rz = useColumnResize({
    colsRef,
    hasWidth: (id) => widths[id] !== undefined,
    onCommit: onCommitWidths,
    onReset: onResetWidths,
  })
  const main = state.threads["main"]

  // 展平为渲染单元（主线 + 各槽位），在相邻两个「展开列」之间插入分割线
  const cells: { thread: Thread; folded: boolean; vpIndex: number }[] = []
  if (main) cells.push({ thread: main, folded: false, vpIndex: -1 })
  slots.forEach((s, i) => {
    const t = state.threads[s.id]
    if (t) cells.push({ thread: t, folded: s.folded, vpIndex: i })
  })

  const nodes: React.ReactNode[] = []
  cells.forEach((c, i) => {
    const prev = cells[i - 1]
    if (prev && !prev.folded && !c.folded) {
      nodes.push(
        <ColumnResizer
          key={`rz:${prev.thread.id}:${c.thread.id}`}
          leftId={prev.thread.id}
          rightId={c.thread.id}
          label={`调整「${prev.thread.title}」与「${c.thread.title}」的列宽`}
          rz={rz}
        />
      )
    }
    nodes.push(
      c.folded ? (
        <FoldedStrip
          key={c.thread.id}
          thread={c.thread}
          onClick={() => onExpandStrip(c.thread.id)}
        />
      ) : (
        <ColumnShell
          key={c.thread.id}
          thread={c.thread}
          width={widths[c.thread.id]}
          flashing={flashId === c.thread.id}
        >
          {renderThread(c.thread.id, c.vpIndex)}
        </ColumnShell>
      )
    )
  })

  return (
    <div className="cols" ref={colsRef}>
      {nodes}
    </div>
  )
}
