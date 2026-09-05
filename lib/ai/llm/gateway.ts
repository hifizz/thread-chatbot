import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createGateway, gateway, type LanguageModel } from "ai"

/** Vercel AI Gateway 的服务端客户端；缺少 key 时由调用方先做配置检查。 */
export function vercelGatewayClient() {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim()
  const baseURL = process.env.AI_GATEWAY_BASE_URL?.trim()
  return baseURL
    ? createGateway({ apiKey, baseURL })
    : apiKey
      ? createGateway({ apiKey })
      : gateway
}

export function isVercelGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim())
}

/** 通过 Vercel AI Gateway 创建模型；真实模型 ID 只在服务端传入。 */
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

/**
 * 通过 Cloudflare AI Gateway compat 端点创建 OpenAI-compatible 模型。
 * Cloudflare 仍需要对应上游 provider 的 API Key。
 */
export function cloudflareGatewayChatModel(input: {
  providerName: string
  upstreamModel: string
  upstreamApiKey: string
  gatewayModel?: string
}): LanguageModel {
  const token = process.env.CF_AI_GATEWAY_TOKEN?.trim()
  const provider = createOpenAICompatible({
    name: `${input.providerName}-via-cf`,
    baseURL: cloudflareGatewayBaseURL(),
    apiKey: input.upstreamApiKey,
    includeUsage: true,
    headers: token
      ? { "cf-aig-authorization": `Bearer ${token}` }
      : undefined,
  })

  return provider(input.gatewayModel ?? input.upstreamModel)
}

/** 按 generation ID 查询 Vercel Gateway 的真实成本。 */
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
