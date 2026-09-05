import { openaiModels } from "@/constants/models"
import { createModels } from "@/lib/ai/llm/create-models"
import {
  isVercelGatewayConfigured,
  vercelGatewayChatModel,
} from "@/lib/ai/llm/gateway"

export const openaiModelProvider = createModels({
  models: openaiModels,
  isConfigured: isVercelGatewayConfigured,
  createProvider: () => (model) =>
    vercelGatewayChatModel(`openai/${model.id}`),
})
