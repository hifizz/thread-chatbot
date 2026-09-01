import type {
  ModelMessage,
  ProviderOptions,
  SystemModelMessage,
  ToolSet,
} from "ai"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

export type PromptSegmentKind =
  | "agent-kernel"
  | "project-contract"
  | "inherited-history"
  | "branch-history"
  | "runtime-control"
  | "current-user"

export type PromptCacheScope =
  | "global"
  | "project"
  | "fork-prefix"
  | "thread-prefix"
  | "none"

export type CacheStability =
  | "stable-prefix"
  | "dynamic-tail"
  | "non-model-metadata"
  | "intentional-partition"

export interface PromptSegmentSummary {
  kind: PromptSegmentKind
  scope: PromptCacheScope
  stability: CacheStability
  contentHash: string
  characters: number
  messageCount: number
}

export type PromptCacheBoundaryKind =
  | "kernel-end"
  | "inherited-end"
  | "branch-history-end"

export interface PromptCacheBoundary {
  kind: PromptCacheBoundaryKind
  prefixHash: string
  characters: number
  tokenEstimate?: number
}

export type PromptCacheEligibilityReason =
  | "eligible"
  | "below-minimum"
  | "unsupported"
  | "probe-required"
  | "retention-disabled"
  | "tool-profile-changed"
  | "route-changed"
  | "prefix-changed"
  | "unknown"

export interface PromptManifest {
  promptCompilerVersion: string
  agentKernelVersion: string
  quoteProtocolVersion: string
  quoteModelFormatVersion: string
  quoteBudgetPolicyVersion: string
  promptCacheProfileVersion: string
  providerRoutingPolicyVersion: string

  toolProfileId: string
  toolProfileHash: string
  routeId: string

  forkContextHash: string
  stableRequestPrefixHash: string
  stablePrefixCharacters: number
  stablePrefixTokenEstimate?: number

  currentUserQuoteCount: number
  currentUserQuoteCharacters: number

  segments: PromptSegmentSummary[]
  candidateBoundaries: PromptCacheBoundary[]
  cacheEligibility: {
    eligible: boolean
    reason: PromptCacheEligibilityReason
  }
}

export interface PromptBase {
  inheritedMessages: ModelMessage[]
  branchHistoryMessages: ModelMessage[]
  currentUserMessages: ModelMessage[]
  currentUserUiMessage: ThreadChatUIMessage
  forkContextHash: string
  inheritedCharacters: number
  branchHistoryCharacters: number
}

export interface RuntimePromptControl {
  researchMode: "answer" | "fetch" | "search" | "research"
  researchPlanText?: string
}

export interface CompiledGenerationPrompt {
  system: SystemModelMessage[]
  messages: ModelMessage[]
  tools: ToolSet
  providerOptions?: ProviderOptions
  headers?: Record<string, string>
  manifest: PromptManifest
}

export type PromptCacheStrategy =
  | "implicit"
  | "explicit-breakpoint"
  | "gateway-auto"
  | "unsupported"
  | "probe-required"

export interface ResolvedChatModelRoute {
  model: import("ai").LanguageModel
  route: {
    appModelId: string
    adapter:
      | "gateway"
      | "openrouter"
      | "anthropic"
      | "openai-compatible"
      | "private-relay"
      | "ark"
      | "minimax"
    gateway:
      | "vercel"
      | "cloudflare"
      | "openrouter"
      | "umapis"
      | null
    upstreamModelId: string
    routeId: string
    routingPolicyVersion: string
  }
  cache: {
    strategy: PromptCacheStrategy
    profileVersion: string
    supportsAffinity: boolean
    supportsCacheReadUsage: boolean
    supportsCacheWriteUsage: boolean
    supportedTtls: Array<"provider-default" | "5m" | "1h">
    minimumPrefixTokens?: number
    maxBreakpoints?: number
    retentionClass: "ephemeral-memory" | "extended" | "unknown"
  }
}
