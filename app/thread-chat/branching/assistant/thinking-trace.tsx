"use client"

import { useEffect, useRef, useState } from "react"
import ThinkingState from "@/components/primitives/ThinkingState"
import type { ResearchRoute } from "@/lib/chat/research-contract"
import {
  settledResearchActivities,
  type WebResearchActivity,
} from "@/lib/chat/web-research-activity"
import type { MarkdownGenerationProgress } from "../../core/types"

/* 把消息上已投影的 reasoning / 联网活动 / 工具事件映射为 beautiful-ui
 * ThinkingState 轨迹。官方 token 由 `.bui` 作用域提供（app/beautifui/foundation.css），
 * 正文流中的间距由 `.tc .thinking-trace` 提供，组件自身不感知宿主设计系统。 */

interface TraceRow {
  primary: string
  secondary?: string
  mono?: boolean
  href?: string
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** 思维链：reasoning part 的分段文本 → Reasoning 变体；耗时在客户端首次捕获。 */
export function ReasoningTrace({ part }: { part: { text: string; state?: string } }) {
  const working = part.state === "streaming"
  const startRef = useRef<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null)

  useEffect(() => {
    if (part.state === "streaming") {
      if (startRef.current === null) startRef.current = Date.now()
      return
    }
    if (startRef.current !== null && elapsedSeconds === null) {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startRef.current) / 1000)))
    }
  }, [part.state, elapsedSeconds])

  const rows: TraceRow[] = part.text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((primary) => ({ primary }))

  if (!working && rows.length === 1) {
    return (
      <div
        className="thinking-trace-compact"
        data-ui-message-part="reasoning"
      >
        {rows[0].primary
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/__([^_]+)__/g, "$1")}
      </div>
    )
  }

  return (
    <div className="thinking-trace bui" data-ui-message-part="reasoning">
      <ThinkingState
        variant="Reasoning"
        working={working}
        active="思考中"
        done={elapsedSeconds === null ? "已思考" : `思考了 ${elapsedSeconds} 秒`}
        rows={rows}
      />
    </div>
  )
}

/** 联网轨迹：search/read 活动 → Search 变体；来源按 url 去重后合并为一列。 */
export function SearchTrace({
  activities,
  route,
  complete,
  settled = false,
}: {
  activities: WebResearchActivity[]
  route?: ResearchRoute
  complete: boolean
  settled?: boolean
}) {
  if (activities.length === 0) return null

  const currentActivities = settledResearchActivities(activities, settled)

  const rows: TraceRow[] = []
  const seen = new Set<string>()
  for (const activity of currentActivities) {
    if (activity.kind === "search") {
      for (const source of activity.sources) {
        if (seen.has(source.url)) continue
        seen.add(source.url)
        rows.push({
          primary: source.title,
          secondary: hostOf(source.url),
          href: source.url,
        })
      }
    } else if (activity.url && !seen.has(activity.url)) {
      seen.add(activity.url)
      rows.push({
        primary: hostOf(activity.url),
        secondary: activity.url,
        mono: true,
        href: activity.url,
      })
    }
  }

  const working =
    !complete && currentActivities.some((activity) => activity.status === "running")
  const fetchMode = route?.mode === "fetch"

  return (
    <div className="thinking-trace bui">
      <ThinkingState
        variant="Search"
        working={working}
        active={fetchMode ? "正在读取网页" : "正在搜索网络"}
        done={fetchMode ? "已读取网页" : `已搜索网络 · ${rows.length} 个来源`}
        rows={rows}
      />
    </div>
  )
}

/** 工具轨迹：createMarkdownArtifact 等 → Coding 变体；联网工具由 SearchTrace 表达。 */
export function ToolTrace({
  toolState,
  progress,
}: {
  toolState?: string
  progress?: MarkdownGenerationProgress
}) {
  const finished = toolState === "output-available" || toolState === "output-error"
  const secondary =
    progress?.partialTitle ??
    (progress && progress.characterCount > 0
      ? `${progress.characterCount} 字`
      : undefined)

  return (
    <div className="thinking-trace bui">
      <ThinkingState
        variant="Coding"
        working={!finished}
        active="正在生成文档"
        done={toolState === "output-error" ? "生成失败" : "已生成文档"}
        rows={[{ primary: "生成文档", secondary, mono: true }]}
      />
    </div>
  )
}
