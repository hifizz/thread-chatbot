import {
  PROMPT_CACHE_MODES,
  resolvePromptCacheMode,
  type PromptCacheMode,
} from "@/constants/prompt-cache"

export interface PromptCacheRoutePolicy {
  mode: PromptCacheMode
  ttl: "provider-default" | "5m"
  extendedTtlEnabled: false
}

function routeOverrides(value: string | undefined): Record<string, PromptCacheMode> {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(
        ([routeId, mode]) =>
          typeof mode === "string" &&
          PROMPT_CACHE_MODES.includes(mode as PromptCacheMode)
            ? [[routeId, mode as PromptCacheMode]]
            : []
      )
    )
  } catch {
    return {}
  }
}

/**
 * Route 级发布策略。1 小时 Extended TTL 在 v1 中硬关闭，不能通过环境变量绕开。
 */
export function resolvePromptCacheRoutePolicy(input: {
  routeId: string
  globalMode?: string
  routeModesJson?: string
  preferFiveMinutes?: boolean
}): PromptCacheRoutePolicy {
  const global = resolvePromptCacheMode(input.globalMode)
  const overrides = routeOverrides(
    input.routeModesJson ?? process.env.THREAD_CHAT_PROMPT_CACHE_ROUTE_MODES
  )
  return {
    mode: overrides[input.routeId] ?? global,
    ttl: input.preferFiveMinutes ? "5m" : "provider-default",
    extendedTtlEnabled: false,
  }
}

export function isRouteCacheControlAllowed(input: {
  policy: PromptCacheRoutePolicy
  strategy: string
  probeVerified: boolean
}): boolean {
  return (
    input.policy.mode === "enabled" &&
    input.probeVerified &&
    input.strategy !== "unsupported" &&
    input.strategy !== "probe-required"
  )
}
