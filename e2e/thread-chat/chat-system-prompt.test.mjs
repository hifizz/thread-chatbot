import assert from "node:assert/strict"
import {
  DIRECT_FETCH_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  WEB_ACCESS_SYSTEM_PROMPT,
} from "../../constants/research.ts"
import { buildChatSystemPrompt } from "../../app/api/chat/system-prompt.ts"

const base = {
  researchMode: "answer",
  researchPlan: null,
  deepResearchRequested: false,
  searchReady: true,
}

assert.equal(buildChatSystemPrompt(base), "")

const fetchPrompt = buildChatSystemPrompt({
  ...base,
  researchMode: "fetch",
})
assert.equal(fetchPrompt, DIRECT_FETCH_SYSTEM_PROMPT)

const searchPrompt = buildChatSystemPrompt({
  ...base,
  researchMode: "search",
})
assert.equal(searchPrompt, WEB_ACCESS_SYSTEM_PROMPT)

const researchPlan = {
  goal: "核验目标",
  subquestions: [
    {
      id: "q1",
      question: "核验什么？",
      queries: ["official source"],
      preferredSourceTypes: ["official"],
      requiresPageFetch: true,
    },
  ],
  exitCriteria: {
    minimumIndependentSources: 2,
    requirePrimarySources: true,
    freshnessRequired: false,
  },
}
const researchPrompt = buildChatSystemPrompt({
  ...base,
  researchMode: "research",
  researchPlan,
})
assert.ok(researchPrompt.includes(WEB_ACCESS_SYSTEM_PROMPT))
assert.ok(researchPrompt.includes(RESEARCH_SYSTEM_PROMPT))
assert.ok(researchPrompt.includes("研究目标：核验目标"))

const unavailablePrompt = buildChatSystemPrompt({
  ...base,
  deepResearchRequested: true,
  searchReady: false,
})
assert.match(unavailablePrompt, /服务端未启用搜索服务/)

console.log(
  "PASS  linear chat system prompt composes web, research plan, and unavailable-search segments"
)
