import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { extractReasoningMiddleware, wrapLanguageModel } from "ai"
import { minimaxModels } from "@/constants/models"
import { createModels } from "@/lib/ai/llm/create-models"

export const minimaxProvider = createOpenAICompatible({
  name: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1",
  apiKey: process.env.MINIMAX_API_KEY,
  includeUsage: true,
})

export const DEFAULT_MODEL_ID = "MiniMax-M2"

export function modelId() {
  return process.env.LLM_MODEL_ID ?? DEFAULT_MODEL_ID
}

export function minimaxChatModel(id: string = modelId()) {
  return wrapLanguageModel({
    model: minimaxProvider(id),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  })
}

export function minimaxModel(id: string = modelId()) {
  return minimaxProvider(id)
}

export function isMinimaxConfigured() {
  return Boolean(process.env.MINIMAX_API_KEY)
}

export const minimaxModelProvider = createModels({
  models: minimaxModels,
  isConfigured: isMinimaxConfigured,
  createProvider: () => (model) => minimaxChatModel(model.id),
})
