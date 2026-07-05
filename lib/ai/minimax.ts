import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { extractReasoningMiddleware, wrapLanguageModel } from "ai"

// MiniMax（OpenAI 兼容端点）的共享 provider，供 chat route 与附件洞察等复用。

export const minimaxProvider = createOpenAICompatible({
  name: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1",
  apiKey: process.env.MINIMAX_API_KEY,
})

export const DEFAULT_MODEL_ID = "MiniMax-M2"

export function modelId() {
  return process.env.LLM_MODEL_ID ?? DEFAULT_MODEL_ID
}

/**
 * 对话用模型：MiniMax 把推理输出成 <think>...</think> 纯文本，用中间件抽取为
 * 独立 reasoning part，UI 才能折叠展示而不是当正文。
 */
export function minimaxChatModel(id: string = modelId()) {
  return wrapLanguageModel({
    model: minimaxProvider(id),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  })
}

/** 生成类任务（摘要/建议问题等）用的裸模型，无需 reasoning 抽取 */
export function minimaxModel(id: string = modelId()) {
  return minimaxProvider(id)
}

export function isMinimaxConfigured() {
  return Boolean(process.env.MINIMAX_API_KEY)
}
