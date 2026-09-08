"use client"

import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/** 禁用按钮不接收指针事件，由外层统一提供光标和可键盘访问的原因提示。 */
export function DisabledComposerOption({ disabled, reason, children }: {
  disabled: boolean
  reason: string
  children: ReactNode
}) {
  if (!disabled) return children
  return <TooltipProvider delay={300}>
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} aria-disabled="true" className="inline-flex cursor-not-allowed [&>button]:pointer-events-none" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" showArrow={false}>{reason}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
}
