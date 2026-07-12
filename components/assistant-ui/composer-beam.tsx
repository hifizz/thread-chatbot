"use client"

import type { FC, ReactNode } from "react"
import { useAuiState } from "@assistant-ui/react"
import { PulseBeam } from "@/components/assistant-ui/pulse-beam"

/**
 * composer 外壳专用的 pulse-inner 呼吸光晕。
 * 光晕绑定 AI 回复状态：回复中淡入并流动，回复结束淡出，
 * 作为「正在生成」的运行状态反馈。
 * wrapper 自带 overflow:hidden 会裁掉外壳的投影，
 * 所以把浅色模式的投影从外壳复制到 wrapper 上。
 */
export const ComposerBeam: FC<{ children: ReactNode }> = ({ children }) => {
  const isRunning = useAuiState((s) => s.thread.isRunning)

  return (
    <PulseBeam
      active={isRunning}
      className="w-full rounded-(--composer-radius) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-shadow focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-none"
    >
      {children}
    </PulseBeam>
  )
}
