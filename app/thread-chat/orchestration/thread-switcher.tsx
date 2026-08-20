"use client"
/**
 * orchestration/thread-switcher —— 会话切换 / 会话树面板的 shell 组合：
 * · global（⌘K）走 shadcn/ui Dialog 居中外壳；
 * · column / subtree 走按钮旁的 fixed 定位外壳；
 * · 搜索、最近访问、键盘导航和树行渲染由 ThreadSwitcherPanel 统一提供。
 */

import React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Dialog, DialogPortal } from "@/components/ui/dialog"
import type { ThreadTreeState } from "../core/types"
import type { TreeRow } from "../core/selectors"
import type { Slot } from "./placement"
import { SWITCHER_DIMENSIONS } from "./switcher-dimensions"
import { ThreadSwitcherPanel, type SwitcherMode } from "./thread-switcher-panel"

export type { SwitcherMode } from "./thread-switcher-panel"

/**
 * Dialog 关闭回调的统一策略：Esc 的权威在壳层 keydown 逐层关闭链。
 * 取消 Dialog 内建 Esc 并放行冒泡，其余关闭原因照常回壳层。
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

export interface ThreadSwitcherProps {
  state: ThreadTreeState
  mode: SwitcherMode
  /** 当前列槽（用于「锚定 / 第N列 / 细条 / 本列」状态徽标） */
  slots: Slot[]
  /** 最近访问的会话 id（global 模式的 chips） */
  recents: string[]
  /** true = 正在播放关闭动画（Dialog open=false / local 加 .closing） */
  closing?: boolean
  /** Dialog Portal 的挂载点（.tc 根），保留 switcher CSS 作用域与变量 */
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
  const isGlobal = mode.kind === "global"
  const isSubtree = mode.kind === "subtree"
  const panelClass = isGlobal ? "global" : isSubtree ? "subtree" : "local"
  const panelStyle =
    mode.kind === "global"
      ? undefined
      : ({
          left: mode.x,
          top: mode.y,
          "--swx-panel-width": `${SWITCHER_DIMENSIONS[mode.kind].width}px`,
          "--swx-panel-height": `${SWITCHER_DIMENSIONS[mode.kind].height}px`,
        } as React.CSSProperties)
  const panel = (
    <ThreadSwitcherPanel
      state={state}
      mode={mode}
      slots={slots}
      recents={recents}
      onPick={onPick}
    />
  )

  // global：受控 Dialog 关闭时以 data-ending-style 播放退场；modal=false 保持
  // 不锁滚动 / 不困焦点，点外关闭仍由 Backdrop 的 onMouseDown 负责。
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
            {panel}
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
    )
  }

  // column / subtree：fixed 锚定面板；closing class 触发 CSS 退场后由壳层卸载。
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
        {panel}
      </div>
    </>
  )
}
