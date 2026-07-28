import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { ARK_CODING_BASE_URL } from "@/constants/ark"

/** Coding Plan key 是否已配置。该 key 只在服务端读取。 */
export function isArkCodingConfigured(): boolean {
  return Boolean(process.env.ARK_CODING_API_KEY)
}

/** 通过火山方舟 Coding Plan 的 OpenAI-compatible 协议创建模型。 */
export function arkCodingChatModel(modelId: string): LanguageModel {
  const apiKey = process.env.ARK_CODING_API_KEY
  if (!apiKey) throw new Error("火山方舟 Coding Plan 未配置 API Key")

  const provider = createOpenAICompatible({
    name: "ark-coding",
    baseURL: process.env.ARK_CODING_BASE_URL ?? ARK_CODING_BASE_URL,
    apiKey,
    // Coding Plan 流式响应会返回 usage；显式开启以供现有计费链路消费。
    includeUsage: true,
  })

  return provider(modelId)
}
