import type {
  PromptCachePolicy,
  PromptCacheRouteIdentity,
} from "@/lib/thread-chat/contracts/prompt-cache"

export function resolvePromptCachePolicy(
  route: PromptCacheRouteIdentity
): PromptCachePolicy {
  const eligible =
    // 受控读写验证见 docs/prompt-cache/iceland-verification.md。
    route.actualProvider === "iceland-relay" &&
    route.protocol === "anthropic" &&
    route.upstreamModel === "claude-sonnet-5"

  return eligible
    ? {
        explicitCacheEnabled: true,
        namespace: "anthropic",
        type: "ephemeral",
        ttl: "5m",
      }
    : { explicitCacheEnabled: false }
}
