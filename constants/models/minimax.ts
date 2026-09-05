import { defineProviderModels } from "@/constants/models/types"

export const minimaxModels = defineProviderModels({
  id: "minimax",
  name: "MiniMax",
  defaults: {
    description: "通用对话模型（直连）",
    surfaces: ["linear"],
    capabilities: { reasoning: true },
  },
  models: [{ id: "MiniMax-M2", name: "MiniMax M2" }],
  toPublicModelId: (modelId) => modelId.toLowerCase(),
})
