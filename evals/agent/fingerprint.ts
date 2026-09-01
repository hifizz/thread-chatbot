import { createHash } from "node:crypto"

const SENSITIVE_KEY =
  /(?:secret|password|authorization|cookie|api[-_]?key|access[-_]?token|private[-_]?key)/i

export type EvaluationCandidateConfig = {
  candidate: string
  model: string
  promptVersion: string
  searchPolicyVersion: string
  searchProvider: string
  memoryPolicyVersion: string
  contextPolicy: string
  toolsetVersion: string
  multimodalParserVersion: string
  promptCompilerVersion: string
  agentKernelVersion: string
  quoteProtocolVersion: string
  quoteModelFormatVersion: string
  quoteBudgetPolicyVersion: string
  promptCacheProfileVersion: string
  promptCacheMode: "off" | "observe" | "enabled"
  toolProfilePolicy: string
  providerRoutePolicy: string
  providerRoutingPolicyVersion: string
  release: string
  commit: string
  environment: "evaluation"
  evaluatorVersion: string
  [key: string]: unknown
}

function sanitized(value: unknown, root = false): unknown {
  if (Array.isArray(value))
    return value
      .map((item) => sanitized(item))
      .filter((item) => item !== undefined)
  if (!value || typeof value !== "object") return value
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sanitized(nested)] as const)
    .filter((entry) => entry[1] !== undefined)
  if (!root && Object.keys(value).length > 0 && entries.length === 0) {
    return undefined
  }
  return Object.fromEntries(entries)
}

export function canonicalEvaluationJson(value: unknown): string {
  return JSON.stringify(sanitized(value, true))
}

export function evaluationConfigFingerprint(
  config: EvaluationCandidateConfig
): string {
  return createHash("sha256")
    .update(canonicalEvaluationJson(config))
    .digest("hex")
}

export function publicEvaluationConfig(
  config: EvaluationCandidateConfig
): EvaluationCandidateConfig {
  return sanitized(config, true) as EvaluationCandidateConfig
}
