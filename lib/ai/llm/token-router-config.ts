export function normalizeTokenRouterBaseURL(
  baseURL: string | undefined = process.env.TOKEN_ROUTER_BASE_URL
): string {
  const configured = baseURL?.trim()
  if (!configured) throw new Error("Token Router 未配置 Base URL")
  const normalized = configured.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

export function isTokenRouterConfigured(): boolean {
  return Boolean(
    process.env.TOKEN_ROUTER_BASE_URL?.trim() &&
    process.env.TOKEN_ROUTER_API_KEY?.trim()
  )
}
