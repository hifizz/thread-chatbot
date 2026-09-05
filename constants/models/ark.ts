import { defineProviderModels } from "@/constants/models/types"

export const arkModels = defineProviderModels({
  id: "ark",
  name: "济州岛",
  defaults: {
    description: "Coding Plan",
    surfaces: ["linear", "thread"],
  },
  models: [
    { id: "doubao-seed-2.1-turbo", name: "Doubao Seed 2.1 Turbo" },
    { id: "doubao-seed-2.0-lite", name: "Doubao Seed 2.0 Lite" },
    {
      id: "minimax-m2.7",
      name: "MiniMax M2.7",
      surfaces: ["linear"],
    },
    { id: "minimax-m3", name: "MiniMax M3" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
  ],
})
