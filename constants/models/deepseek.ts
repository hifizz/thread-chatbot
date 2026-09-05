import { defineProviderModels } from "@/constants/models/types"

export const deepseekModels = defineProviderModels({
  id: "deepseek",
  name: "DeepSeek",
  defaults: {
    description: "高性价比通用模型（经 Cloudflare AI Gateway）",
    surfaces: ["linear"],
  },
  models: [{ id: "deepseek-chat", name: "DeepSeek V3.2" }],
})
