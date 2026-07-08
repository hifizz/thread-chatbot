import { create } from "zustand"
import type { DemoArtifact } from "./types"

// 工作台全局状态：createDemo 工具 UI 在流式期间把 artifact 持续 upsert 进来，
// WorkbenchPanel 订阅 activeId 渲染右侧面板。artifacts 以 toolCallId 为键，
// 历史消息重新挂载时同样会 upsert（幂等），因此刷新后旧 Demo 依然可以打开。

export type WorkbenchView = "preview" | "code"
/** 预览运行时：Sandpack 浏览器沙箱（默认）或 Apple container 容器沙箱（实验，真 next dev） */
export type WorkbenchRuntime = "sandpack" | "container"

type WorkbenchState = {
  artifacts: Record<string, DemoArtifact>
  activeId: string | null
  open: boolean
  view: WorkbenchView
  runtime: WorkbenchRuntime
  upsertArtifact: (artifact: DemoArtifact) => void
  openArtifact: (id: string) => void
  setView: (view: WorkbenchView) => void
  setRuntime: (runtime: WorkbenchRuntime) => void
  close: () => void
}

export const useWorkbench = create<WorkbenchState>((set) => ({
  artifacts: {},
  activeId: null,
  open: false,
  view: "preview",
  runtime: "sandpack",
  upsertArtifact: (artifact) =>
    set((s) => ({ artifacts: { ...s.artifacts, [artifact.id]: artifact } })),
  openArtifact: (id) => set({ activeId: id, open: true }),
  setView: (view) => set({ view }),
  setRuntime: (runtime) => set({ runtime }),
  close: () => set({ open: false }),
}))
