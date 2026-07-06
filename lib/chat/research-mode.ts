import { create } from "zustand"

// 深度研究模式开关。composer 的开关与 transport 的 prepareSendMessagesRequest 都读它：
// 开启后每条消息的请求体带上 deepResearch 标志，chat route 据此启用联网研究工具与多步循环。

type ResearchModeState = {
  enabled: boolean
  toggle: () => void
  set: (enabled: boolean) => void
}

export const useResearchMode = create<ResearchModeState>((set) => ({
  enabled: false,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  set: (enabled) => set({ enabled }),
}))
