import type { WebSearchActivity } from "../core/types"

export type WebSearchActivitySummary = {
  phase: "searching" | "completed" | "failed"
  queryLabel?: string
  queryCount: number
  internalCallCount: number
  acceptedCallCount: number
  resultCount: number
  durationMs?: number
  sources: NonNullable<WebSearchActivity["sources"]>
  error?: string
}

/**
 * UI 以一条 assistant 消息为边界展示联网过程，而不是把模型的每个内部 tool
 * call 直接暴露成一张卡。成功来源优先：额外的无效/预算拒绝调用不应把已完成
 * 的搜索呈现成失败；原始 call 仍留在内存态供调试与计量关联。
 */
export function summarizeWebSearchActivities(
  activities: readonly WebSearchActivity[]
): WebSearchActivitySummary | null {
  if (activities.length === 0) return null

  const completedActivities = activities.filter(
    (activity) => activity.phase === "completed"
  )
  // 成功后只汇总真正产出来源的调用；失败 call 既不占查询数，也不污染耗时。
  const visibleActivities =
    completedActivities.length > 0 ? completedActivities : activities
  const queries = [
    ...new Set(visibleActivities.flatMap((item) => item.query ?? [])),
  ]
  const sources = new Map<
    string,
    NonNullable<WebSearchActivity["sources"]>[number]
  >()
  let durationMs = 0
  let hasDuration = false
  let hasCompleted = false
  let hasActive = false
  let firstError: string | undefined

  for (const activity of visibleActivities) {
    if (activity.durationMs !== undefined) {
      durationMs += activity.durationMs
      hasDuration = true
    }
    if (!firstError && activity.error) firstError = activity.error
    for (const source of activity.sources ?? []) {
      if (!sources.has(source.url)) sources.set(source.url, source)
    }
  }

  hasCompleted = completedActivities.length > 0
  hasActive = activities.some(
    (activity) =>
      activity.phase === "starting" || activity.phase === "searching"
  )

  const phase = hasActive ? "searching" : hasCompleted ? "completed" : "failed"
  return {
    phase,
    ...(queries.length ? { queryLabel: queries.join(" · ") } : {}),
    queryCount: queries.length,
    internalCallCount: activities.length,
    acceptedCallCount: completedActivities.length,
    resultCount: sources.size,
    ...(hasDuration ? { durationMs } : {}),
    sources: [...sources.values()],
    // 有任一成功结果时，不把后续被预算拒绝的冗余调用渲染为用户可见失败。
    ...(phase === "failed" && firstError ? { error: firstError } : {}),
  }
}
