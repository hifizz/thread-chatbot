import type {
  PromptCachePolicy,
  PromptCacheRouteIdentity,
} from "@/lib/thread-chat/contracts/prompt-cache"

// 旧线路的显式缓存策略不自动迁移到新中继；当前注册线路均不匹配。
const LEGACY_UMAPIS_ANTHROPIC_MODELS = new Set([
  "claude-opus-5",
  "claude-sonnet-5",
])

export function resolvePromptCachePolicy(
  route: PromptCacheRouteIdentity
): PromptCachePolicy {
  const eligible =
    route.actualProvider === "umapis" &&
    route.protocol === "anthropic" &&
    route.credentialGroup === "claude" &&
    LEGACY_UMAPIS_ANTHROPIC_MODELS.has(route.upstreamModel)

  return eligible
    ? {
        explicitCacheEnabled: true,
        namespace: "anthropic",
        type: "ephemeral",
        ttl: "5m",
      }
    : { explicitCacheEnabled: false }
}
