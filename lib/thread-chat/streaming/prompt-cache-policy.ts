import type {
  PromptCachePolicy,
  PromptCacheRouteIdentity,
} from "@/lib/thread-chat/contracts/prompt-cache"

const VERIFIED_UMAPIS_ANTHROPIC_MODELS = new Set([
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
    VERIFIED_UMAPIS_ANTHROPIC_MODELS.has(route.upstreamModel)

  return eligible
    ? {
        explicitCacheEnabled: true,
        namespace: "anthropic",
        type: "ephemeral",
        ttl: "5m",
      }
    : { explicitCacheEnabled: false }
}
