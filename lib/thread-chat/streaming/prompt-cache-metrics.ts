import type { PromptCacheObservation } from "@/lib/thread-chat/contracts/prompt-cache"

export interface PromptCacheMetricDimensions {
  actualProvider: string
  upstreamModel: string
  generationMode: PromptCacheObservation["generationMode"]
  promptSchemaVersion: string
}

export interface PromptCacheAggregate {
  dimensions: PromptCacheMetricDimensions
  requestCount: number
  knownRequestCount: number
  hitRequestCount: number
  writeRequestCount: number
  unknownRequestCount: number
  requestHitRate?: number
  cacheWriteRate?: number
  unknownRate: number
  metricFormula: PromptCacheObservation["metricFormula"]
  tokenHitRate?: number
}

function dimensionsOf(
  observation: PromptCacheObservation
): PromptCacheMetricDimensions {
  return {
    actualProvider: observation.route.actualProvider,
    upstreamModel: observation.route.upstreamModel,
    generationMode: observation.generationMode,
    promptSchemaVersion: observation.promptSchemaVersion,
  }
}

function keyOf(dimensions: PromptCacheMetricDimensions): string {
  return JSON.stringify(dimensions)
}

/** Project Contract 版本保留在单次摘要，不进入默认聚合标签。 */
export function aggregatePromptCacheObservations(
  observations: readonly PromptCacheObservation[]
): PromptCacheAggregate[] {
  const groups = new Map<
    string,
    { dimensions: PromptCacheMetricDimensions; rows: PromptCacheObservation[] }
  >()
  for (const observation of observations) {
    const dimensions = dimensionsOf(observation)
    const key = keyOf(dimensions)
    const group = groups.get(key) ?? { dimensions, rows: [] }
    group.rows.push(observation)
    groups.set(key, group)
  }

  return [...groups.values()].map(({ dimensions, rows }) => {
    const known = rows.filter((row) => row.status !== "unknown")
    const hits = known.filter((row) => row.status === "hit").length
    const writes = rows.filter((row) => (row.cacheWriteTokens ?? 0) > 0).length
    const detailed = rows.filter(
      (row) =>
        row.noCacheTokens !== undefined &&
        row.cacheReadTokens !== undefined &&
        row.cacheWriteTokens !== undefined
    )
    const useDetailed = detailed.length === rows.length
    const canFallback = rows.every(
      (row) =>
        row.inputTokens !== undefined && row.cacheReadTokens !== undefined
    )
    const numerator = rows.reduce(
      (total, row) => total + (row.cacheReadTokens ?? 0),
      0
    )
    const denominator = useDetailed
      ? rows.reduce(
          (total, row) =>
            total +
            row.noCacheTokens! +
            row.cacheReadTokens! +
            row.cacheWriteTokens!,
          0
        )
      : canFallback
        ? rows.reduce((total, row) => total + row.inputTokens!, 0)
        : undefined
    const formula = useDetailed
      ? "detailed-input"
      : canFallback
        ? "input-total"
        : "unavailable"

    return {
      dimensions,
      requestCount: rows.length,
      knownRequestCount: known.length,
      hitRequestCount: hits,
      writeRequestCount: writes,
      unknownRequestCount: rows.length - known.length,
      ...(known.length > 0 ? { requestHitRate: hits / known.length } : {}),
      ...(rows.length > 0 ? { cacheWriteRate: writes / rows.length } : {}),
      unknownRate:
        rows.length > 0 ? (rows.length - known.length) / rows.length : 0,
      metricFormula: formula,
      ...(denominator !== undefined && denominator > 0
        ? { tokenHitRate: numerator / denominator }
        : {}),
    }
  })
}
