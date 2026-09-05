import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createGateway, gateway, type LanguageModel } from "ai"

let vercelClient: ReturnType<typeof createGateway> | undefined
const cloudflareProviders = new Map<
  string,
  ReturnType<typeof createOpenAICompatible>
>()

export function vercelGatewayClient() {
  if (vercelClient) return vercelClient
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim()
  const baseURL = process.env.AI_GATEWAY_BASE_URL?.trim()
  vercelClient = baseURL
    ? createGateway({ apiKey, baseURL })
    : apiKey
      ? createGateway({ apiKey })
      : gateway
  return vercelClient
}

export function isVercelGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim())
}

export function vercelGatewayChatModel(modelId: string): LanguageModel {
  if (!isVercelGatewayConfigured()) {
    throw new Error("Vercel AI Gateway 未配置 API Key")
  }
  return vercelGatewayClient()(modelId)
}

function cloudflareGatewayBaseURL(): string {
  const accountId = process.env.CF_AI_GATEWAY_ACCOUNT_ID?.trim()
  const gatewayId = process.env.CF_AI_GATEWAY_ID?.trim()
  if (!accountId || !gatewayId) {
    throw new Error("Cloudflare AI Gateway 未配置账号或网关")
  }
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`
}

export function isCloudflareGatewayConfigured(): boolean {
  return Boolean(
    process.env.CF_AI_GATEWAY_ACCOUNT_ID?.trim() &&
      process.env.CF_AI_GATEWAY_ID?.trim()
  )
}

export function cloudflareGatewayChatModel(input: {
  providerName: string
  upstreamModel: string
  upstreamApiKey: string
  gatewayModel?: string
}): LanguageModel {
  let provider = cloudflareProviders.get(input.providerName)
  if (!provider) {
    const token = process.env.CF_AI_GATEWAY_TOKEN?.trim()
    provider = createOpenAICompatible({
      name: `${input.providerName}-via-cf`,
      baseURL: cloudflareGatewayBaseURL(),
      apiKey: input.upstreamApiKey,
      includeUsage: true,
      headers: token
        ? { "cf-aig-authorization": `Bearer ${token}` }
        : undefined,
    })
    cloudflareProviders.set(input.providerName, provider)
  }
  return provider(input.gatewayModel ?? input.upstreamModel)
}

export async function getVercelGatewayGenerationCostUsd(
  generationId: string
): Promise<number | null> {
  try {
    const info = await vercelGatewayClient().getGenerationInfo({
      id: generationId,
    })
    return typeof info.totalCost === "number" ? info.totalCost : null
  } catch {
    return null
  }
}
