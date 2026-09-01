export const THREAD_CHAT_PROMPT_COMPILER_VERSION =
  "thread-chat-prompt-compiler-v1" as const
export const THREAD_CHAT_AGENT_KERNEL_VERSION =
  "thread-chat-agent-kernel-v1" as const
export const THREAD_CHAT_PROMPT_CACHE_PROFILE_VERSION =
  "thread-chat-prompt-cache-v1" as const
export const THREAD_CHAT_PROVIDER_ROUTING_POLICY_VERSION =
  "thread-chat-routing-v1" as const
export const THREAD_CHAT_TOOL_POLICY_VERSION =
  "thread-chat-tool-policy-v1" as const

export type PromptCacheRolloutMode = "off" | "observe" | "enabled"

export function promptCacheRolloutMode(): PromptCacheRolloutMode {
  const configured = process.env.THREAD_CHAT_PROMPT_CACHE_MODE?.trim()
  return configured === "observe" || configured === "enabled"
    ? configured
    : "off"
}

/** Extended retention is deliberately disabled until cost and policy evidence exists. */
export function promptCacheTtlPolicy(): "provider-default" | "5m" {
  return process.env.THREAD_CHAT_PROMPT_CACHE_TTL === "5m"
    ? "5m"
    : "provider-default"
}
