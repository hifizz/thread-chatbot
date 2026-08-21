import assert from "node:assert/strict"

import {
  isResearchPlanStreamEvent,
  isResearchRouteStreamEvent,
} from "../../lib/chat/research-events.ts"

const route = {
  type: "data-research-route",
  data: {
    mode: "search",
    reasonCode: "explicit_search",
    urls: [],
    suggestedQueries: ["current release"],
  },
}
assert.equal(isResearchRouteStreamEvent(route), true)
assert.equal(
  isResearchRouteStreamEvent({
    ...route,
    data: { ...route.data, reasonCode: "invented_reason" },
  }),
  false
)
assert.equal(
  isResearchRouteStreamEvent({
    ...route,
    data: { ...route.data, urls: [1] },
  }),
  false
)

const plan = {
  type: "data-research-plan",
  data: {
    goal: "Compare current releases",
    subquestions: [
      {
        id: "q1",
        question: "What changed?",
        queries: ["release notes"],
        preferredSourceTypes: ["official"],
        requiresPageFetch: true,
      },
    ],
    exitCriteria: {
      minimumIndependentSources: 2,
      requirePrimarySources: true,
      freshnessRequired: true,
    },
  },
}
assert.equal(isResearchPlanStreamEvent(plan), true)
assert.equal(
  isResearchPlanStreamEvent({
    ...plan,
    data: { ...plan.data, goal: "" },
  }),
  false
)
assert.equal(
  isResearchPlanStreamEvent({
    ...plan,
    data: {
      ...plan.data,
      exitCriteria: { ...plan.data.exitCriteria, minimumIndependentSources: 99 },
    },
  }),
  false
)

console.log(
  "PASS  research SSE events reuse the authoritative route and plan schemas"
)
