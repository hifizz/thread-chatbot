import {
  researchPlanSchema,
  researchRouteSchema,
  type ResearchPlan,
  type ResearchRoute,
} from "./research-contract"

export interface ResearchRouteStreamEvent {
  type: "data-research-route"
  data: ResearchRoute
}

export interface ResearchPlanStreamEvent {
  type: "data-research-plan"
  data: ResearchPlan
}

export function isResearchRouteStreamEvent(
  value: unknown
): value is ResearchRouteStreamEvent {
  if (typeof value !== "object" || value === null) return false
  const event = value as Record<string, unknown>
  return (
    event.type === "data-research-route" &&
    researchRouteSchema.safeParse(event.data).success
  )
}

export function isResearchPlanStreamEvent(
  value: unknown
): value is ResearchPlanStreamEvent {
  if (typeof value !== "object" || value === null) return false
  const event = value as Record<string, unknown>
  return (
    event.type === "data-research-plan" &&
    researchPlanSchema.safeParse(event.data).success
  )
}
