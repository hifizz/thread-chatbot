import { create } from "zustand"
import { DEFAULT_MODEL_ID } from "@/constants/model"

// 当前选中的对话模型。输入框的模型选择器写它；transport 的
// prepareSendMessagesRequest 读它，随每条消息把 modelId 发给 chat route。
// 与「深度研究」开关（research-mode.ts）同一套模式。

type ModelModeState = {
  modelId: string
  setModel: (modelId: string) => void
}

export const useModelMode = create<ModelModeState>((set) => ({
  modelId: DEFAULT_MODEL_ID,
  setModel: (modelId) => set({ modelId }),
}))
