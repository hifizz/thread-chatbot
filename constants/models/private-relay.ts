import { defineProviderModels } from "@/constants/models/types"

export const privateRelayModels = defineProviderModels({
  id: "private-relay",
  name: "塞班岛",
  defaults: {
    surfaces: ["thread"],
    capabilities: { attachments: true, imageInput: true },
    unbilledPreview: true,
  },
  models: [
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      description: "质量优先，适合复杂推理、复杂编码和专业工作。",
    },
    {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      description: "质量优先，适合复杂推理、复杂编码和专业工作。",
    },
    {
      id: "gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      description: "能力、延迟和配额消耗均衡，推荐用于日常复杂任务。",
    },
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      description: "面向高吞吐和低消耗任务的快速模型。",
    },
    {
      id: "gpt-5.5",
      name: "GPT-5.5",
      description: "高能力通用模型，适合作为复杂工具型 Agent 的回退。",
    },
    {
      id: "gpt-5.4",
      name: "GPT-5.4",
      description: "成熟的通用编码与专业工作模型，适合作为稳定回退。",
    },
    {
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      description: "面向高吞吐的快速模型，适合编码和子 Agent。",
    },
    {
      id: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      description: "快速 Codex 编码模型；兼容性验证中。",
    },
  ],
  toPublicModelId: (modelId) => `private-relay-${modelId}`,
})
