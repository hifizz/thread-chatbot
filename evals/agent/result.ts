import type { AgentSuite } from "@/evals/agent/schema"

/** 工具模拟评测保存完整调用证据；只允许合成资料进入此执行器。 */
export type EvaluationToolCall = {
  toolCallId: string
  toolName: string
  input: unknown
  output?: unknown
  error?: string
}

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
    toolCalls?: EvaluationToolCall[]
    finishReason?: string
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
  toolCalls?: EvaluationToolCall[]
  finishReason?: string
  terminalState?: AgentExperimentResult["output"]["terminalState"]
  usage?: Record<string, number>
  providerAttempts?: AgentExperimentResult["providerAttempts"]
}
