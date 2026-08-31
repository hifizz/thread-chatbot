import { sha256 } from "@/lib/thread-chat/application/prompt-compiler"
import { runDeterministicCacheProbe } from "@/lib/ai/prompt-cache-probe"
import type { EvaluationScore } from "@/evals/agent/result"

export const PROMPT_CACHE_EVALUATOR_VERSION =
  "prompt-cache-evaluator-v1" as const

export interface PromptCacheFixtureResult {
  stablePrefixHashLeft: string
  stablePrefixHashRight: string
  fullShapeHashLeft: string
  fullShapeHashRight: string
  quoteCount: number
  modelText: string
  forbiddenMetadata: string[]
  cacheReadTokens?: number
  totalCost?: number
  netSavings?: number
  qualityGatePassed: boolean
}

function score(input: {
  name: string
  passed: boolean
  severity?: "hard" | "quality" | "diagnostic"
  value?: number | string
  comment?: string
}): EvaluationScore {
  return {
    name: input.name,
    value: input.value ?? (input.passed ? 1 : 0),
    deterministic: true,
    severity: input.severity ?? "hard",
    signal: "evaluation",
    passed: input.passed,
    ...(input.comment ? { comment: input.comment } : {}),
    evaluatorVersion: PROMPT_CACHE_EVALUATOR_VERSION,
  }
}

export function scorePromptCacheFixture(
  result: PromptCacheFixtureResult
): EvaluationScore[] {
  const metadataExcluded = result.forbiddenMetadata.every(
    (value) => !result.modelText.includes(value)
  )
  const prefixEqual =
    result.stablePrefixHashLeft === result.stablePrefixHashRight
  const tailDifferent = result.fullShapeHashLeft !== result.fullShapeHashRight
  const quoteCountValid = result.quoteCount >= 0 && result.quoteCount <= 50
  const costBeneficial =
    result.netSavings === undefined || result.netSavings > 0
  return [
    score({ name: "prompt-cache-prefix-equality", passed: prefixEqual }),
    score({ name: "prompt-cache-tail-difference", passed: tailDifferent }),
    score({ name: "prompt-cache-metadata-excluded", passed: metadataExcluded }),
    score({ name: "prompt-cache-quote-count", passed: quoteCountValid }),
    score({
      name: "prompt-cache-quality-gate",
      passed: result.qualityGatePassed,
      severity: "quality",
    }),
    score({
      name: "prompt-cache-net-savings",
      passed: costBeneficial,
      severity: "diagnostic",
      value: result.netSavings ?? "unavailable",
    }),
    score({
      name: "prompt-cache-provider-read",
      passed:
        result.cacheReadTokens === undefined || result.cacheReadTokens > 0,
      severity: "diagnostic",
      value: result.cacheReadTokens ?? "unavailable",
    }),
  ]
}

export function promptCacheCandidateFingerprint(input: {
  candidate: string
  promptCompilerVersion: string
  agentKernelVersion: string
  quoteProtocolVersion: string
  quoteModelFormatVersion: string
  quoteBudgetPolicyVersion: string
  toolProfileId: string
  routeId: string
  routingPolicyVersion: string
  cacheProfileVersion: string
}): string {
  return sha256(input)
}

export function fakeClaudeCacheFixture(input: {
  qualityGatePassed?: boolean
  ttlMs?: number
} = {}) {
  return runDeterministicCacheProbe({
    routeId: "fake:umapis-claude",
    rates: {
      uncachedInputPerMillion: 3,
      cacheWritePerMillion: 3.75,
      cacheReadPerMillion: 0.3,
      outputPerMillion: 15,
    },
    ...(input.qualityGatePassed !== undefined
      ? { qualityGatePassed: input.qualityGatePassed }
      : {}),
    ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
  })
}
