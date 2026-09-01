import {
  normalizePromptCacheUsage,
  type PromptCacheUsage,
} from "@/lib/thread-chat/prompt-cache/usage"

/** Cache telemetry is best-effort and must never fail a successful model step. */
export function safeNormalizePromptCacheUsage(input: {
  usage?: unknown
  providerMetadata?: unknown
}): PromptCacheUsage {
  try {
    return normalizePromptCacheUsage(input)
  } catch {
    return {
      source: "unavailable",
      complete: false,
    }
  }
}
