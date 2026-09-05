import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { icelandModels } from "@/constants/models"
import { createModels } from "@/lib/ai/llm/create-models"

export type IcelandRelayProtocol = "anthropic" | "openai"

let anthropicProvider: ReturnType<typeof createAnthropic> | undefined
let openaiProvider: ReturnType<typeof createOpenAICompatible> | undefined

export function normalizeIcelandRelayBaseURL(
  baseURL: string | undefined = process.env.ICELAND_RELAY_BASE_URL
): string {
  const configured = baseURL?.trim()
  if (!configured) throw new Error("冰岛 Relay 未配置 Base URL")
  const normalized = configured.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

function apiKey(): string {
  const value = process.env.ICELAND_RELAY_API_KEY?.trim()
  if (!value) throw new Error("冰岛 Relay 未配置 API Key")
  return value
}

function getAnthropicProvider() {
  return (anthropicProvider ??= createAnthropic({
    name: "iceland-relay-anthropic",
    baseURL: normalizeIcelandRelayBaseURL(),
    apiKey: apiKey(),
  }))
}

function getOpenAIProvider() {
  return (openaiProvider ??= createOpenAICompatible({
    name: "iceland-relay-openai",
    baseURL: normalizeIcelandRelayBaseURL(),
    apiKey: apiKey(),
    includeUsage: true,
  }))
}

function protocol(modelId: string): IcelandRelayProtocol {
  return modelId.startsWith("claude-") ? "anthropic" : "openai"
}

export function isIcelandRelayConfigured(): boolean {
  return Boolean(
    process.env.ICELAND_RELAY_BASE_URL?.trim() &&
      process.env.ICELAND_RELAY_API_KEY?.trim()
  )
}

export function icelandRelayChatModel(
  modelId: string,
  modelProtocol: IcelandRelayProtocol
): LanguageModel {
  return modelProtocol === "anthropic"
    ? getAnthropicProvider()(modelId)
    : getOpenAIProvider()(modelId)
}

export const icelandModelProvider = createModels({
  models: icelandModels,
  isConfigured: isIcelandRelayConfigured,
  createProvider: () => (model) =>
    icelandRelayChatModel(model.id, protocol(model.id)),
})
