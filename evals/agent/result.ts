import type { AgentSuite } from "@/evals/agent/schema"
import type { ModelAttemptRecord } from "@/lib/ai/model-attempt"

export type EvaluationScore = {
  name: string
  value: number | string
  deterministic: boolean
  severity: "hard" | "quality" | "diagnostic"
  signal: "evaluation" | "judge"
  passed?: boolean
  comment?: string
  evaluatorVersion: string
}

export type AgentCacheSummary = {
  eligible: boolean
  reason: string
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  uncachedInputTokens?: number
  cacheReadRatio?: number
  costUsd?: number
  requestPrefixHash?: string
  toolProfileId?: string
  routeId?: string
  quoteCount?: number
  metadataExcluded?: boolean
}

export type AgentExperimentResult = {
  schemaVersion: "agent-result-v1"
  runId: string
  caseId: string
  suite: AgentSuite
  candidate: string
  candidateFingerprint: string
  datasetRevision: string
  traceId: string
  output: {
    text: string
    route?: "answer" | "fetch" | "search" | "research"
    tools: string[]
    terminalState: "completed" | "stopped" | "failed"
  }
  timing: {
    startedAt: string
    endedAt: string
    durationMs: number
  }
  usage: Record<string, number>
  providerAttempts: Array<Record<string, string | number | boolean>>
  modelAttempts: ModelAttemptRecord[]
  cache?: AgentCacheSummary
  scores: EvaluationScore[]
  error?: {
    category: string
    message: string
  }
}

export type AgentExecutionOutput = {
  traceId?: string
  text: string
  route?: AgentExperimentResult["output"]["route"]
  tools?: string[]
  terminalState?: AgentExperimentResult["output"]["terminalState"]
  usage?: Record<string, number>
  providerAttempts?: AgentExperimentResult["providerAttempts"]
  modelAttempts?: ModelAttemptRecord[]
  cache?: AgentCacheSummary
}
