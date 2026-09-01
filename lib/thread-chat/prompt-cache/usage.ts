export type PromptCacheUsageSource =
  | "ai-sdk-usage"
  | "provider-metadata"
  | "gateway-metadata"
  | "derived"
  | "unavailable"

export interface PromptCacheUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  uncachedInputTokens?: number
  costUsd?: number
  source: PromptCacheUsageSource
  complete: boolean
}

export interface ModelAttemptRecord {
  stepIndex: number
  purpose: string
  routeId: string
  upstreamModelId: string
  toolProfileId: string
  stableRequestPrefixHash: string
  cacheStrategy: string
  cacheEligibility: string
  finishReason?: string
  durationMs?: number
  ttftMs?: number
  usage: PromptCacheUsage
}

export interface PromptCacheRunSummary extends PromptCacheUsage {
  attemptCount: number
  providerHit: boolean | null
  cacheReadRatio?: number
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function firstNumber(
  records: readonly (UnknownRecord | null)[],
  keys: readonly string[]
): number | undefined {
  for (const record of records) {
    if (!record) continue
    for (const key of keys) {
      const value = finiteNonNegative(record[key])
      if (value !== undefined) return value
    }
  }
  return undefined
}

function nestedRecords(root: UnknownRecord | null): UnknownRecord[] {
  if (!root) return []
  const results: UnknownRecord[] = [root]
  const queue: UnknownRecord[] = [root]
  const seen = new Set<UnknownRecord>(queue)
  while (queue.length > 0 && results.length < 80) {
    const current = queue.shift()!
    for (const value of Object.values(current)) {
      const nested = asRecord(value)
      if (nested && !seen.has(nested)) {
        seen.add(nested)
        queue.push(nested)
        results.push(nested)
      }
    }
  }
  return results
}

function usageRecords(usage: unknown): UnknownRecord[] {
  const root = asRecord(usage)
  if (!root) return []
  const details = [
    asRecord(root.inputTokenDetails),
    asRecord(root.inputTokensDetails),
    asRecord(root.promptTokensDetails),
    asRecord(root.prompt_tokens_details),
  ].filter((value): value is UnknownRecord => value !== null)
  return [root, ...details]
}

export function normalizePromptCacheUsage(input: {
  usage?: unknown
  providerMetadata?: unknown
}): PromptCacheUsage {
  const standard = usageRecords(input.usage)
  const provider = nestedRecords(asRecord(input.providerMetadata))

  const inputTokens = firstNumber(standard, [
    "inputTokens",
    "promptTokens",
    "prompt_tokens",
  ])
  const outputTokens = firstNumber(standard, [
    "outputTokens",
    "completionTokens",
    "completion_tokens",
  ])
  const totalTokens = firstNumber(standard, ["totalTokens", "total_tokens"])
  const standardCacheRead = firstNumber(standard, [
    "cacheReadTokens",
    "cachedTokens",
    "cached_tokens",
    "cache_read_input_tokens",
    "cacheReadInputTokens",
  ])
  const standardCacheWrite = firstNumber(standard, [
    "cacheWriteTokens",
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
  ])
  const providerCacheRead = firstNumber(provider, [
    "cacheReadTokens",
    "cachedTokens",
    "cached_tokens",
    "cache_read_input_tokens",
    "cacheReadInputTokens",
  ])
  const providerCacheWrite = firstNumber(provider, [
    "cacheWriteTokens",
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
  ])
  const cacheReadTokens = standardCacheRead ?? providerCacheRead
  const cacheWriteTokens = standardCacheWrite ?? providerCacheWrite
  const costUsd = firstNumber(provider, [
    "cost",
    "costUsd",
    "cost_usd",
    "totalCost",
  ])

  let uncachedInputTokens: number | undefined
  if (
    inputTokens !== undefined &&
    cacheReadTokens !== undefined &&
    cacheWriteTokens !== undefined
  ) {
    uncachedInputTokens = Math.max(
      0,
      inputTokens - cacheReadTokens - cacheWriteTokens
    )
  }

  const source: PromptCacheUsageSource =
    standardCacheRead !== undefined || standardCacheWrite !== undefined
      ? "ai-sdk-usage"
      : providerCacheRead !== undefined || providerCacheWrite !== undefined
        ? "provider-metadata"
        : standard.length > 0
          ? "ai-sdk-usage"
          : provider.length > 0
            ? "gateway-metadata"
            : "unavailable"
  const complete =
    inputTokens !== undefined &&
    cacheReadTokens !== undefined &&
    cacheWriteTokens !== undefined

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(uncachedInputTokens !== undefined ? { uncachedInputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    source,
    complete,
  }
}

function sumDefined(
  records: readonly PromptCacheUsage[],
  field:
    | "inputTokens"
    | "outputTokens"
    | "totalTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
    | "uncachedInputTokens"
    | "costUsd"
): number | undefined {
  const values = records.flatMap((record) => {
    const value = record[field]
    return value === undefined ? [] : [value]
  })
  return values.length === 0
    ? undefined
    : values.reduce((total, value) => total + value, 0)
}

export function summarizeModelAttempts(
  attempts: readonly ModelAttemptRecord[]
): PromptCacheRunSummary {
  const usage = attempts.map((attempt) => attempt.usage)
  const inputTokens = sumDefined(usage, "inputTokens")
  const cacheReadTokens = sumDefined(usage, "cacheReadTokens")
  const cacheWriteTokens = sumDefined(usage, "cacheWriteTokens")
  const outputTokens = sumDefined(usage, "outputTokens")
  const totalTokens = sumDefined(usage, "totalTokens")
  const uncachedInputTokens = sumDefined(usage, "uncachedInputTokens")
  const costUsd = sumDefined(usage, "costUsd")
  const hasEvidence = usage.some(
    (item) => item.cacheReadTokens !== undefined
  )
  const providerHit = hasEvidence
    ? (cacheReadTokens ?? 0) > 0
    : null
  const cacheReadRatio =
    inputTokens !== undefined && inputTokens > 0 && cacheReadTokens !== undefined
      ? cacheReadTokens / inputTokens
      : undefined

  return {
    attemptCount: attempts.length,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(uncachedInputTokens !== undefined ? { uncachedInputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(cacheReadRatio !== undefined ? { cacheReadRatio } : {}),
    providerHit,
    source:
      usage.length === 0
        ? "unavailable"
        : usage.every((item) => item.source === usage[0]?.source)
          ? (usage[0]?.source ?? "unavailable")
          : "derived",
    complete: usage.length > 0 && usage.every((item) => item.complete),
  }
}
