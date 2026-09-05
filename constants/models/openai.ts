import { defineProviderModels } from "@/constants/models/types"

export const openaiModels = defineProviderModels({
  id: "openai",
  name: "OpenAI",
  defaults: {
    description: "OpenAI 轻量模型（经 Vercel AI Gateway）",
    surfaces: ["linear"],
  },
  models: [{ id: "gpt-4o-mini", name: "GPT-4o mini" }],
})
