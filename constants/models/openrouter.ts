import { defineProviderModels } from "@/constants/models/types"

export const openrouterModels = defineProviderModels({
  id: "openrouter",
  name: "巴厘岛",
  defaults: {
    surfaces: ["thread"],
  },
  models: [
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "openai/gpt-5.6-luna-pro", name: "GPT-5.6 Luna Pro" },
    { id: "openai/gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "openai/gpt-5.6-terra-pro", name: "GPT-5.6 Terra Pro" },
    { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "openai/gpt-5.6-sol-pro", name: "GPT-5.6 Sol Pro" },
    { id: "openai/gpt-5.5", name: "GPT-5.5" },
    { id: "openai/gpt-5.5-pro", name: "GPT-5.5 Pro" },
    { id: "moonshotai/kimi-k3", name: "Kimi K3" },
    {
      id: "deepseek/deepseek-v4-flash-0731",
      name: "DeepSeek V4 Flash 0731",
    },
    { id: "qwen/qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "x-ai/grok-4.5", name: "Grok 4.5" },
    { id: "x-ai/grok-4.6", name: "Grok 4.6" },
    {
      id: "stealth/ox-alpha",
      name: "Ox Alpha",
      description: "面向编程与长时 Agent 任务的免费预览模型",
      unbilledPreview: true,
    },
  ],
  toPublicModelId: (modelId) =>
    `openrouter-${modelId.slice(modelId.lastIndexOf("/") + 1)}`,
})
