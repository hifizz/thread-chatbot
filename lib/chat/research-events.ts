import type { ResearchPlan, ResearchRoute } from "./research-router"

export interface ResearchRouteStreamEvent {
  type: "data-research-route"
  data: ResearchRoute
}

export interface ResearchPlanStreamEvent {
  type: "data-research-plan"
  data: ResearchPlan
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

const ROUTE_MODES = new Set(["answer", "fetch", "search", "research"])

export function isResearchRouteStreamEvent(
  value: unknown
): value is ResearchRouteStreamEvent {
  if (!isRecord(value) || value.type !== "data-research-route") return false
  const data = value.data
  return (
    isRecord(data) &&
    typeof data.mode === "string" &&
    ROUTE_MODES.has(data.mode) &&
    typeof data.reasonCode === "string" &&
    Array.isArray(data.urls) &&
    Array.isArray(data.suggestedQueries)
  )
}

export function isResearchPlanStreamEvent(
  value: unknown
): value is ResearchPlanStreamEvent {
  if (!isRecord(value) || value.type !== "data-research-plan") return false
  const data = value.data
  if (
    !isRecord(data) ||
    typeof data.goal !== "string" ||
    !Array.isArray(data.subquestions) ||
    data.subquestions.length === 0 ||
    !isRecord(data.exitCriteria)
  )
    return false

  return (
    data.subquestions.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.question === "string" &&
        Array.isArray(item.queries) &&
        item.queries.every((query) => typeof query === "string") &&
        Array.isArray(item.preferredSourceTypes) &&
        item.preferredSourceTypes.every(
          (sourceType) => typeof sourceType === "string"
        ) &&
        typeof item.requiresPageFetch === "boolean"
    ) &&
    typeof data.exitCriteria.minimumIndependentSources === "number" &&
    typeof data.exitCriteria.requirePrimarySources === "boolean" &&
    typeof data.exitCriteria.freshnessRequired === "boolean"
  )
}
