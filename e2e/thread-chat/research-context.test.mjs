import assert from "node:assert/strict"
import { resolveResearchContext } from "../../app/api/chat/research-context.ts"

const model = {}
const messages = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "先前问题" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "先前回答" }] },
  { id: "u2", role: "user", parts: [{ type: "text", text: "最新问题" }] },
]

let resolveCalls = 0
let planCalls = 0
const plan = {
  goal: "最新问题",
  subquestions: [],
  exitCriteria: {
    minimumIndependentSources: 1,
    requirePrimarySources: false,
    freshnessRequired: false,
  },
}
const dependencies = {
  async resolveRoute(input) {
    resolveCalls++
    assert.equal(input.latestUserText, "最新问题")
    assert.match(input.recentConversation, /先前问题/)
    assert.equal(input.searchReady, true)
    return {
      mode: "research",
      reasonCode: "multi_source_research",
      urls: [],
      suggestedQueries: ["query"],
    }
  },
  async createPlan(input) {
    planCalls++
    assert.equal(input.userRequest, "最新问题")
    assert.equal(input.route.mode, "research")
    return plan
  },
}

const forcedResearch = await resolveResearchContext(
  {
    model,
    messages,
    deepResearchRequested: true,
    searchReady: true,
  },
  dependencies
)
assert.equal(resolveCalls, 0)
assert.equal(planCalls, 1)
assert.equal(forcedResearch.latestText, "最新问题")
assert.equal(forcedResearch.researchRoute.mode, "research")
assert.equal(forcedResearch.researchPlan, plan)

const unavailable = await resolveResearchContext(
  {
    model,
    messages,
    deepResearchRequested: true,
    searchReady: false,
  },
  dependencies
)
assert.equal(resolveCalls, 0)
assert.equal(planCalls, 1)
assert.equal(unavailable.researchRoute.reasonCode, "search_unavailable")
assert.equal(unavailable.researchPlan, null)

const routedResearch = await resolveResearchContext(
  {
    model,
    messages,
    deepResearchRequested: false,
    searchReady: true,
  },
  dependencies
)
assert.equal(resolveCalls, 1)
assert.equal(planCalls, 2)
assert.equal(routedResearch.researchPlan, plan)

const answer = await resolveResearchContext(
  {
    model,
    messages,
    deepResearchRequested: false,
    searchReady: true,
  },
  {
    ...dependencies,
    async resolveRoute() {
      return {
        mode: "answer",
        reasonCode: "no_web_needed",
        urls: [],
        suggestedQueries: [],
      }
    },
  }
)
assert.equal(answer.researchPlan, null)
assert.equal(planCalls, 2)

console.log(
  "PASS  research context owns forced routing, conversation inputs, and conditional planning"
)
