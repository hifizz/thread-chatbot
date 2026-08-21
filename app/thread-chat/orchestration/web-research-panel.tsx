"use client"

import {
  ResearchPanelView,
  type ResearchStep,
} from "@/components/assistant-ui/research-panel"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"

export function WebResearchPanel({
  activities,
  route,
  plan,
  complete,
}: {
  activities: WebResearchActivity[]
  route?: ResearchRoute
  plan?: ResearchPlan
  complete?: boolean
}) {
  // 路由和 Planner 先于真实工具事件到达；不能据此把面板提前放到正文顶部。
  // 第一次 webSearch/readUrl 开始后再显示，位置由消息记录的文本偏移决定。
  if (activities.length === 0) return null

  const steps: ResearchStep[] = activities.map((activity) =>
    activity.kind === "search"
      ? {
          kind: "search",
          query: activity.query ?? "正在生成搜索词…",
          sources: activity.sources.map((source) => ({
            ...source,
            snippet: "",
          })),
          running: activity.status === "running",
        }
      : {
          kind: "read",
          url: activity.url ?? "正在选择网页…",
          running: activity.status === "running",
        }
  )

  const anyRunning = activities.some(
    (activity) => activity.status === "running"
  )
  const title =
    route?.mode === "research"
      ? "深度研究"
      : route?.mode === "fetch"
        ? "网页读取"
        : "联网搜索"
  const searchActivities = activities.filter(
    (activity) => activity.kind === "search"
  )
  const completedSearchGroups = new Set(
    searchActivities
      .filter((activity) => activity.sources.length > 0)
      .map(
        (activity) =>
          activity.query?.trim().toLowerCase().replace(/\s+/g, " ") ??
          activity.toolCallId
      )
  ).size
  const lastQuery = [...searchActivities]
    .reverse()
    .find((activity) => activity.query)?.query
  const firstReadUrl = activities.find(
    (activity) => activity.kind === "read" && activity.url
  )?.url
  const shortenedGoal = plan?.goal.trim().replace(/\s+/g, " ").slice(0, 84)
  const completionText = shortenedGoal
    ? `完成了「${shortenedGoal}${plan && plan.goal.length > 84 ? "…" : ""}」的资料检索与回答。`
    : route?.mode === "fetch"
      ? firstReadUrl
        ? `读取并整理了 ${hostOf(firstReadUrl)} 的网页内容。`
        : "完成了目标网页的读取与整理。"
      : completedSearchGroups > 1
        ? `完成了 ${completedSearchGroups} 组联网检索并整理了回答。`
        : lastQuery
          ? `完成了「${lastQuery}」的联网检索。`
          : "完成了联网检索并整理了回答。"

  return (
    <ResearchPanelView
      steps={steps}
      anyRunning={anyRunning}
      complete={complete}
      title={title}
      completionText={completionText}
      plan={plan ? { goal: plan.goal } : undefined}
    />
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}
