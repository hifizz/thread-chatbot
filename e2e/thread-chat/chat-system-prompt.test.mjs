import assert from "node:assert/strict"
import {
  DIRECT_FETCH_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  WEB_ACCESS_SYSTEM_PROMPT,
} from "../../constants/research.ts"
import { THREAD_CHAT_SYSTEM } from "../../constants/thread-chat.ts"
import { buildChatSystemPrompt } from "../../app/api/chat/system-prompt.ts"

const base = {
  threadChat: false,
  anchorText: null,
  markdownArtifactRequested: false,
  researchMode: "answer",
  researchPlan: null,
  deepResearchRequested: false,
  searchReady: true,
}

assert.equal(buildChatSystemPrompt(base), "")

const threadPrompt = buildChatSystemPrompt({
  ...base,
  threadChat: true,
  anchorText: "原始锚点",
})
assert.ok(threadPrompt.includes(THREAD_CHAT_SYSTEM))
assert.ok(threadPrompt.includes("原始锚点"))
assert.ok(!threadPrompt.includes(WEB_ACCESS_SYSTEM_PROMPT))

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
  "PASS  chat system prompt composes Thread, web, research plan, and unavailable-search segments"
)
