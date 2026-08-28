import type { AgentSuite } from "@/evals/agent/schema"

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

export type AgentExperimentResult = {
  schemaVersion: "agent-result-v1"
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
}
