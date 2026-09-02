import { createHash } from "node:crypto"
import { createTraceId } from "@langfuse/tracing"
import type { AgentCase } from "@/evals/agent/schema"
import { canonicalEvaluationJson } from "@/evals/agent/fingerprint"

export function stableDatasetItemId(caseId: string): string {
  return `thread-chat-agent:${caseId}`
}

export function datasetRevision(cases: readonly AgentCase[]): string {
  const canonicalCases = [...cases].sort((a, b) => a.id.localeCompare(b.id))
  return createHash("sha256")
    .update(canonicalEvaluationJson(canonicalCases))
    .digest("hex")
}

export async function evaluationTraceId(input: {
  runId: string
  caseId: string
  candidateFingerprint: string
  datasetRevision: string
}): Promise<string> {
  return createTraceId(
    `evaluation:${input.runId}:${input.datasetRevision}:${input.caseId}:${input.candidateFingerprint}`
  )
}
