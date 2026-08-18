"use client"

import {
  ResearchPanelView,
  type ResearchStep,
} from "@/components/assistant-ui/research-panel"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"

export function WebResearchPanel({
  activities,
}: {
  activities: WebResearchActivity[]
}) {
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

  return (
    <ResearchPanelView
      steps={steps}
      anyRunning={activities.some((activity) => activity.status === "running")}
      title="联网搜索"
      completionText="联网检索完成"
    />
  )
}
