export type PromptCacheUsageSource =
  | "ai-sdk-usage"
  | "provider-metadata"
  | "gateway-metadata"
  | "derived"
  | "unavailable"

export type PromptCacheUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  uncachedInputTokens?: number
  costUsd?: number
  source: PromptCacheUsageSource
  complete: boolean
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function finiteNonnegative(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : undefined
}

function path(value: unknown, segments: readonly string[]): unknown {
  let current: unknown = value
  for (const segment of segments) {
    const currentRecord = record(current)
    if (!currentRecord) return undefined
    current = currentRecord[segment]
  }
  return current
}

function firstNumber(
  value: unknown,
  paths: ReadonlyArray<readonly string[]>
): number | undefined {
  for (const candidate of paths) {
    const found = finiteNonnegative(path(value, candidate))
    if (found !== undefined) return found
  }
  return undefined
}

const INPUT_PATHS = [
  ["inputTokens"],
  ["promptTokens"],
  ["prompt_tokens"],
] as const
const OUTPUT_PATHS = [
  ["outputTokens"],
  ["completionTokens"],
  ["completion_tokens"],
] as const
const CACHE_READ_PATHS = [
  ["inputTokenDetails", "cacheReadTokens"],
  ["inputTokenDetails", "cachedTokens"],
  ["promptTokensDetails", "cachedTokens"],
  ["prompt_tokens_details", "cached_tokens"],
  ["cacheReadInputTokens"],
  ["cache_read_input_tokens"],
  ["cached_tokens"],
] as const
const CACHE_WRITE_PATHS = [
  ["inputTokenDetails", "cacheWriteTokens"],
  ["promptTokensDetails", "cacheWriteTokens"],
  ["cacheCreationInputTokens"],
  ["cache_creation_input_tokens"],
  ["cache_write_tokens"],
] as const
const UNCACHED_PATHS = [
  ["inputTokenDetails", "noCacheTokens"],
  ["inputTokenDetails", "uncachedTokens"],
  ["uncachedInputTokens"],
  ["uncached_input_tokens"],
] as const
const COST_PATHS = [
  ["cost"],
  ["costUsd"],
  ["cost_usd"],
  ["usage", "cost"],
] as const

function normalizeFrom(
  value: unknown,
  source: PromptCacheUsageSource
): PromptCacheUsage {
  const inputTokens = firstNumber(value, INPUT_PATHS)
  const outputTokens = firstNumber(value, OUTPUT_PATHS)
  const cacheReadTokens = firstNumber(value, CACHE_READ_PATHS)
  const cacheWriteTokens = firstNumber(value, CACHE_WRITE_PATHS)
  let uncachedInputTokens = firstNumber(value, UNCACHED_PATHS)
  let derived = false
  if (
    uncachedInputTokens === undefined &&
    inputTokens !== undefined &&
    cacheReadTokens !== undefined &&
    cacheWriteTokens !== undefined
  ) {
    uncachedInputTokens = Math.max(
      0,
      inputTokens - cacheReadTokens - cacheWriteTokens
    )
    derived = true
  }
  const costUsd = firstNumber(value, COST_PATHS)
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(uncachedInputTokens !== undefined ? { uncachedInputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    source: derived ? "derived" : source,
    complete:
      inputTokens !== undefined &&
      cacheReadTokens !== undefined &&
      cacheWriteTokens !== undefined &&
      uncachedInputTokens !== undefined,
  }
}

function score(usage: PromptCacheUsage): number {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.uncachedInputTokens,
    usage.costUsd,
  ].filter((value) => value !== undefined).length
}

export function normalizePromptCacheUsage(input: {
  usage?: unknown
  providerMetadata?: unknown
}): PromptCacheUsage {
  const standard = normalizeFrom(input.usage, "ai-sdk-usage")
  const metadataRoot = record(input.providerMetadata)
  const metadataCandidates: PromptCacheUsage[] = []
  if (metadataRoot) {
    for (const [key, value] of Object.entries(metadataRoot)) {
      metadataCandidates.push(
        normalizeFrom(
          value,
          key === "gateway" ? "gateway-metadata" : "provider-metadata"
        )
      )
      const nestedUsage = path(value, ["usage"])
      if (nestedUsage !== undefined) {
        metadataCandidates.push(
          normalizeFrom(
            nestedUsage,
            key === "gateway" ? "gateway-metadata" : "provider-metadata"
          )
        )
      }
    }
  }
  const candidates = [standard, ...metadataCandidates].sort(
    (left, right) => score(right) - score(left)
  )
  const best = candidates[0]
  if (!best || score(best) === 0) {
    return { source: "unavailable", complete: false }
  }
  return best
}

export function aggregatePromptCacheUsage(
  usages: readonly PromptCacheUsage[]
): PromptCacheUsage {
  if (usages.length === 0) return { source: "unavailable", complete: false }
  const sum = (key: keyof PromptCacheUsage): number | undefined => {
    const values = usages.map((usage) => usage[key])
    return values.every((value) => typeof value === "number")
      ? (values as number[]).reduce((total, value) => total + value, 0)
      : undefined
  }
  const inputTokens = sum("inputTokens")
  const outputTokens = sum("outputTokens")
  const cacheReadTokens = sum("cacheReadTokens")
  const cacheWriteTokens = sum("cacheWriteTokens")
  const uncachedInputTokens = sum("uncachedInputTokens")
  const costUsd = sum("costUsd")
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(uncachedInputTokens !== undefined ? { uncachedInputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    source: usages.every((usage) => usage.source === usages[0].source)
      ? usages[0].source
      : "derived",
    complete: usages.every((usage) => usage.complete),
  }
}
