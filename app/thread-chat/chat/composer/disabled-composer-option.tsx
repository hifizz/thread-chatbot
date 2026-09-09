"use client"

import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/** 禁用按钮不接收指针事件，由外层统一提供光标和可键盘访问的原因提示。 */
export function DisabledComposerOption({ disabled, reason, children }: {
  disabled: boolean
  reason: string
  children: ReactNode
}) {
  // 保持按钮节点稳定，避免禁用切换让正在关闭的菜单丢失定位锚点。
  return <TooltipProvider delay={300}>
    <Tooltip disabled={!disabled}>
      <TooltipTrigger render={<span tabIndex={disabled ? 0 : -1} aria-disabled={disabled || undefined} className={disabled ? "inline-flex cursor-not-allowed [&>button]:pointer-events-none" : "inline-flex"} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" showArrow={false}>{reason}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
}
