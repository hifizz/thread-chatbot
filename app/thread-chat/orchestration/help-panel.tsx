"use client"

import type React from "react"
import { CircleHelp, Highlighter } from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Dialog, DialogPortal } from "@/components/ui/dialog"
import { dialogCloseToShell } from "./thread-switcher"

/** 首次内联提示与手动 Help Dialog 共用的功能要点。 */
function UsageTips() {
  return (
    <ul className="helpx-list">
      <li>
        <b>划选 AI 回复里的文字</b>开分支，输入框预填相关问题，改写后回车确认
      </li>
      <li>列数随屏宽自适应（2–4 列），列满默认替换来源列（可撤销）</li>
      <li>
        按住 <span className="kbd">⌘</span>/Ctrl 划选或点脚注 = <b>保留本列</b>
        ，新会话开在紧邻右侧
      </li>
      <li>拖动列间分割线调宽度，双击恢复均分</li>
      <li>面包屑可就地回退到上游会话</li>
      <li>
        <span className="kbd">⌘K</span> 搜索并打开任意会话
      </li>
      <li>
        点列头 <b>⇄</b> 把该列切换成任意会话，<b>⑂</b> 查看子分支
      </li>
      <li>对话里生成的 Markdown 会插入消息流，点击后在右侧面板预览</li>
      <li>顶栏可切换画布视图纵览全树，单击节点就地对话，双击回到列模式</li>
      <li>对话自动保存，刷新或同链接重开可恢复；「新对话」另起一棵树</li>
    </ul>
  )
}

export interface UsageHintProps {
  onDismiss: () => void
}

/** 空白新对话中的首次内联提示。 */
export function UsageHint({ onDismiss }: UsageHintProps) {
  return (
    <div className="hint">
      <Highlighter size={15} color="#b07d2e" />
      <UsageTips />
      <button
        type="button"
        className="close"
        aria-label="关闭使用提示"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  )
}

export interface HelpPanelProps {
  closing?: boolean
  container?: React.RefObject<HTMLElement | null>
  onClose: () => void
}

/** 顶栏帮助入口打开的居中 Dialog。 */
export function HelpPanel({
  closing = false,
  container,
  onClose,
}: HelpPanelProps) {
  return (
    <Dialog
      open={!closing}
      onOpenChange={dialogCloseToShell(onClose)}
      modal={false}
      disablePointerDismissal
    >
      <DialogPortal container={container}>
        <DialogPrimitive.Backdrop className="swx-scrim" onMouseDown={onClose} />
        <DialogPrimitive.Popup
          className="swx global helpx"
          initialFocus={false}
        >
          <DialogPrimitive.Title className="swx-title">
            <CircleHelp size={14} />
            使用提示
          </DialogPrimitive.Title>
          <div className="helpx-body">
            <UsageTips />
          </div>
          <div className="swx-foot">
            <span>点击遮罩关闭</span>
            <span>esc 关闭</span>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
