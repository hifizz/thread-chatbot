import { create } from "zustand"

// 输入框下方 token 统计 & 余额的客户端状态。数据来自 /api/billing/summary，
// 在每轮对话结束（thread 从 running → idle）后刷新。

export type ThreadUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  priceMicros: number
}

export type LastUsage = ThreadUsage & { model: string }

type UsageState = {
  balanceMicros: number | null
  thread: ThreadUsage | null
  last: LastUsage | null
  loading: boolean
  refresh: (threadId?: string | null) => Promise<void>
}

export const useUsageStore = create<UsageState>((set) => ({
  balanceMicros: null,
  thread: null,
  last: null,
  loading: false,
  refresh: async (threadId) => {
    set({ loading: true })
    try {
      const qs = threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""
      const res = await fetch(`/api/billing/summary${qs}`, {
        cache: "no-store",
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        balanceMicros: number
        thread: ThreadUsage | null
        last: LastUsage | null
      }
      set({
        balanceMicros: data.balanceMicros,
        thread: data.thread,
        last: data.last,
      })
    } catch {
      // 静默失败：统计信息非关键路径
    } finally {
      set({ loading: false })
    }
  },
}))
