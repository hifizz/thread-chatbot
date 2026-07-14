import { gateway, createGateway } from "ai"

// Vercel AI 网关：真实成本查询。
// 网关只在响应里回传 providerMetadata.gateway.generationId；真实 cost 要用该 id
// 事后调 getGenerationInfo 拿 totalCost（USD）。生成完成后需稍等才可查（最终一致）。

export function isVercelGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY)
}

// 可用 AI_GATEWAY_BASE_URL 覆盖网关地址（自建/区域代理/测试）。默认走官方 gateway 单例。
function gatewayClient() {
  const baseURL = process.env.AI_GATEWAY_BASE_URL
  return baseURL
    ? createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY, baseURL })
    : gateway
}

/**
 * 按 generationId 拉取该次生成的真实成本（美元）。查不到/未就绪返回 null（交由调用方重试）。
 */
export async function getGenerationCostUsd(
  generationId: string
): Promise<number | null> {
  try {
    const info = await gatewayClient().getGenerationInfo({ id: generationId })
    return typeof info.totalCost === "number" ? info.totalCost : null
  } catch {
    // 未就绪（404）或网络错误：让上层稍后重试
    return null
  }
}
