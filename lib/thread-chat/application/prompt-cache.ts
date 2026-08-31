import { createHash } from "node:crypto"
import type { ModelMessage } from "ai"
import {
  THREAD_AGENT_KERNEL_VERSION,
  THREAD_PROMPT_CACHE_PROFILE_VERSION,
  THREAD_PROMPT_COMPILER_VERSION,
  THREAD_QUOTE_BUDGET_POLICY_VERSION,
  THREAD_QUOTE_MODEL_FORMAT_VERSION,
  THREAD_QUOTE_SCHEMA_VERSION,
} from "@/constants/thread-chat"

export type PromptSegmentKind =
  | "agent-kernel"
  | "project-contract"
  | "inherited-history"
  | "branch-history"
  | "runtime-control"
  | "current-user"

export type CacheStability =
  | "stable-prefix"
  | "dynamic-tail"
  | "non-model-metadata"
  | "intentional-partition"

export type PromptSegment = {
  kind: PromptSegmentKind
  stability: CacheStability
  version: string
  contentHash: string
  characters: number
  messageCount: number
}

export type PromptCacheBoundaryKind =
  | "kernel-end"
  | "inherited-end"
  | "branch-history-end"

export type PromptManifest = {
  promptCompilerVersion: typeof THREAD_PROMPT_COMPILER_VERSION
  agentKernelVersion: typeof THREAD_AGENT_KERNEL_VERSION
  quoteProtocolVersion: typeof THREAD_QUOTE_SCHEMA_VERSION
  quoteModelFormatVersion: typeof THREAD_QUOTE_MODEL_FORMAT_VERSION
  quoteBudgetPolicyVersion: typeof THREAD_QUOTE_BUDGET_POLICY_VERSION
  promptCacheProfileVersion: typeof THREAD_PROMPT_CACHE_PROFILE_VERSION
  toolProfileId: string
  toolProfileHash: string
  routeId: string
  segments: PromptSegment[]
  forkContextHash: string
  stableRequestPrefixHash: string
  stablePrefixCharacters: number
  stablePrefixTokenEstimate?: number
  currentUserQuoteCount: number
  currentUserQuoteCharacters: number
  candidateBoundaries: Array<{
    kind: PromptCacheBoundaryKind
    characterOffset: number
    tokenEstimate?: number
  }>
  cacheEligibility: {
    eligible: boolean
    reason: string
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function canonicalHash(value: unknown): string {
  return sha256Text(stableStringify(value))
}

export function modelMessagesCharacters(
  messages: readonly ModelMessage[]
): number {
  return stableStringify(messages).length
}

export function promptSegment(input: {
  kind: PromptSegmentKind
  stability: CacheStability
  version: string
  content: unknown
  messageCount: number
}): PromptSegment {
  const serialized = stableStringify(input.content)
  return {
    kind: input.kind,
    stability: input.stability,
    version: input.version,
    contentHash: sha256Text(serialized),
    characters: serialized.length,
    messageCount: input.messageCount,
  }
}

export function stablePrefixHash(input: {
  toolProfileId: string
  toolProfileHash: string
  system: unknown
  inheritedMessages: readonly ModelMessage[]
  branchHistoryMessages: readonly ModelMessage[]
}): string {
  return canonicalHash({
    toolProfileId: input.toolProfileId,
    toolProfileHash: input.toolProfileHash,
    system: input.system,
    inheritedMessages: input.inheritedMessages,
    branchHistoryMessages: input.branchHistoryMessages,
  })
}
