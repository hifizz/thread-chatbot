import assert from "node:assert/strict"
import {
  contextualUrlFollowUpRoute,
  deterministicResearchRoute,
} from "../../lib/chat/research-router.ts"

const recent = [
  "user: 看看 https://example.com/release-notes",
  "assistant: 你想了解哪一部分？",
  "user: 总结这个链接",
].join("\n")

assert.deepEqual(contextualUrlFollowUpRoute("总结这个链接", recent), {
  mode: "fetch",
  reasonCode: "explicit_url",
  urls: ["https://example.com/release-notes"],
  suggestedQueries: [],
})
assert.deepEqual(
  contextualUrlFollowUpRoute("Summarize the previous page", recent)?.mode,
  "fetch"
)
assert.equal(contextualUrlFollowUpRoute("总结这段文字", recent), null)
assert.equal(
  contextualUrlFollowUpRoute("不要联网，总结这个链接", recent),
  null
)
assert.equal(deterministicResearchRoute("总结这段文字")?.mode, "answer")

console.log(
  "PASS  referential URL follow-ups fetch prior pages without changing ordinary summaries"
)
