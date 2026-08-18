"use client"

import {
  ResearchPanelView,
  type ResearchStep,
} from "@/components/assistant-ui/research-panel"
import type { MessageStatus } from "../core/types"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"

export function WebResearchPanel({
  activities,
  route,
  plan,
  status,
}: {
  activities: WebResearchActivity[]
  route?: ResearchRoute
  plan?: ResearchPlan
  status?: MessageStatus
}) {
  if (
    activities.length === 0 &&
    !plan &&
    (!route || route.mode === "answer")
  )
    return null

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

  const anyRunning =
    status === "pending" ||
    status === "streaming" ||
    activities.some((activity) => activity.status === "running")
  const title =
    route?.mode === "research"
      ? "深度研究"
      : route?.mode === "fetch"
        ? "网页读取"
        : "联网搜索"

  return (
    <ResearchPanelView
      steps={steps}
      anyRunning={anyRunning}
      title={title}
      completionText={route?.mode === "research" ? "研究完成" : "联网检索完成"}
      plan={
        plan
          ? {
              goal: plan.goal,
              items: plan.subquestions.map((item) => item.question),
            }
          : undefined
      }
    />
  )
}
