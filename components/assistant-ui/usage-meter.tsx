"use client"

import { useEffect, useRef } from "react"
import { useAui, useAuiState } from "@assistant-ui/react"
import { useUsageStore } from "@/lib/chat/usage-store"
import { formatYuan } from "@/constants/pricing"

// 输入框下方右下角的 token 用量 & 余额统计。
// 数据来自 /api/billing/summary，在切换对话与每轮生成结束后刷新。
export function UsageMeter() {
  const aui = useAui()
  const isRunning = useAuiState((s) => s.thread.isRunning)
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId)
  const balanceMicros = useUsageStore((s) => s.balanceMicros)
  const thread = useUsageStore((s) => s.thread)
  const last = useUsageStore((s) => s.last)
  const refresh = useUsageStore((s) => s.refresh)
  const prevRunning = useRef(false)

  const remoteId = () =>
    aui.threadListItem.source
      ? aui.threadListItem().getState().remoteId
      : undefined

  // 挂载 / 切换对话时刷新
  useEffect(() => {
    refresh(remoteId())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainThreadId])

  // 本轮生成结束（running: true → false）后刷新，拿到最新 token 与余额
  useEffect(() => {
    if (prevRunning.current && !isRunning) refresh(remoteId())
    prevRunning.current = isRunning
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning])

  return (
    <div className="flex w-full items-center justify-end gap-2 px-3 text-[11px] text-muted-foreground tabular-nums">
      {last && (
        <span title="上一次回复消耗的 token（输入 + 输出）">
          本次 {last.inputTokens}+{last.outputTokens} tok
        </span>
      )}
      {thread && thread.totalTokens > 0 && (
        <>
          <span aria-hidden>·</span>
          <span title="当前对话累计 token">累计 {thread.totalTokens} tok</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span title="账户剩余额度" className="font-medium text-foreground/70">
        余额 {balanceMicros != null ? formatYuan(balanceMicros, 2) : "--"}
      </span>
    </div>
  )
}
