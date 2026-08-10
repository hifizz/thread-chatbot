"use client"

import { CircleAlert, ExternalLink, Search } from "lucide-react"
import { compactSourceLabel } from "@/lib/chat/source-label"
import type { WebSearchActivity } from "../core/types"
import { summarizeWebSearchActivities } from "../net/web-search-summary"

function durationLabel(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null
  return durationMs < 1000
    ? `${durationMs} ms`
    : `${(durationMs / 1000).toFixed(1)} s`
}

export function WebSearchActivityCard({
  activities,
  compact = false,
}: {
  activities: WebSearchActivity[]
  compact?: boolean
}) {
  const summary = summarizeWebSearchActivities(activities)
  if (!summary) return null
  const busy = summary.phase === "searching"
  const failed = summary.phase === "failed"
  const duration = durationLabel(summary.durationMs)
  const state = busy
    ? summary.resultCount > 0
      ? `正在联网搜索（已查到 ${summary.resultCount} 个信息源）`
      : "正在联网搜索"
    : failed
      ? "联网搜索未完成"
      : `已查到 ${summary.resultCount} 个信息源`
  return (
    <div className={`web-search-activity ${compact ? "compact" : ""}`}>
      <div className={`web-search-call ${summary.phase}`} role="status">
        <div className="web-search-head">
          {failed ? <CircleAlert size={13} /> : <Search size={13} />}
          <span
            className={`web-search-state ${busy ? "shimmer" : ""}`}
          >
            {state}
          </span>
          {duration && <span className="web-search-duration">{duration}</span>}
        </div>
        {summary.queryLabel && (
          <div className="web-search-query" title={summary.queryLabel}>
            {summary.queryCount > 1
              ? `${summary.queryCount} 次查询 · ${summary.queryLabel}`
              : summary.queryLabel}
          </div>
        )}
        {summary.error && (
          <div className="web-search-error">{summary.error}</div>
        )}
        {summary.sources.length > 0 && (
          <div className="web-search-sources" aria-label="搜索信息源">
            {summary.sources.map((source) => (
              <a
                key={`${source.sourceId}:${source.url}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                title={source.title}
              >
                <span>{compactSourceLabel(source.title, source.url)}</span>
                <ExternalLink size={10} aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
        {process.env.NODE_ENV !== "production" && (
          <div className="web-search-debug">
            调试 · {summary.internalCallCount} 个内部调用，
            {summary.acceptedCallCount} 个有效结果批次
          </div>
        )}
      </div>
    </div>
  )
}
