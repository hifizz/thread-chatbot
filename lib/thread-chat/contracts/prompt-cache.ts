export type ThreadChatGenerationModeId =
  | "answer"
  | "answer-artifact"
  | "fetch"
  | "fetch-artifact"
  | "search"
  | "search-artifact"
  | "research"
  | "research-artifact"

export type { ModelRouteIdentity as PromptCacheRouteIdentity } from "@/lib/ai/llm/create-models"
import type { ModelRouteIdentity as PromptCacheRouteIdentity } from "@/lib/ai/llm/create-models"

export interface PromptCachePolicy {
  explicitCacheEnabled: boolean
  namespace?: "anthropic"
  type?: "ephemeral"
  ttl?: "5m"
}

export type PromptCacheObservationStatus = "hit" | "miss" | "unknown"
export type PromptCacheMetricFormula =
  "detailed-input" | "input-total" | "unavailable"

export interface PromptCacheObservation {
  status: PromptCacheObservationStatus
  route: PromptCacheRouteIdentity
  generationMode: ThreadChatGenerationModeId
  promptSchemaVersion: string
  projectContractVersion: number
  explicitCacheEnabled: boolean
  inputTokens?: number
  noCacheTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
  metricFormula: PromptCacheMetricFormula
  tokenHitRate?: number
}
