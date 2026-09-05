import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import type { IcelandRelayProtocol } from "@/constants/model"

export function normalizeIcelandRelayBaseURL(
  baseURL: string | undefined = process.env.ICELAND_RELAY_BASE_URL
): string {
  const configured = baseURL?.trim()
  if (!configured) throw new Error("冰岛 Relay 未配置 Base URL")
  const normalized = configured.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

function getIcelandRelayApiKey(): string | undefined {
  return process.env.ICELAND_RELAY_API_KEY?.trim() || undefined
}

export function isIcelandRelayConfigured(): boolean {
  return Boolean(
    process.env.ICELAND_RELAY_BASE_URL?.trim() && getIcelandRelayApiKey()
  )
}

export function icelandRelayChatModel(
  modelId: string,
  protocol: IcelandRelayProtocol
): LanguageModel {
  const apiKey = getIcelandRelayApiKey()
  if (!apiKey) throw new Error("冰岛 Relay 未配置 API Key")

  if (protocol === "anthropic") {
    const provider = createAnthropic({
      name: "iceland-relay-anthropic",
      baseURL: normalizeIcelandRelayBaseURL(),
      apiKey,
    })
    return provider(modelId)
  }

  const provider = createOpenAICompatible({
    name: "iceland-relay-openai",
    baseURL: normalizeIcelandRelayBaseURL(),
    apiKey,
    includeUsage: true,
  })
  return provider(modelId)
}
