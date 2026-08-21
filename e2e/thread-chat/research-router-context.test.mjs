import assert from "node:assert/strict"
import {
  contextualUrlFollowUpRoute,
  deterministicResearchRoute,
  reasoningForResearchRoute,
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
const umapisClaude = {
  provider: "umapis",
  umapisCredentialGroup: "claude",
}
const umapisGpt = { provider: "umapis", umapisCredentialGroup: "gpt" }
const openRouter = { provider: "openrouter" }
assert.equal(reasoningForResearchRoute("search", umapisClaude), "none")
assert.equal(reasoningForResearchRoute("fetch", umapisClaude), "none")
assert.equal(reasoningForResearchRoute("research", umapisClaude), "none")
assert.equal(
  reasoningForResearchRoute("answer", umapisClaude),
  "provider-default"
)
assert.equal(reasoningForResearchRoute("search", umapisGpt), "medium")
assert.equal(reasoningForResearchRoute("search", openRouter), "medium")
assert.equal(reasoningForResearchRoute("research", openRouter), "high")

console.log(
  "PASS  research routing preserves URL behavior and provider-compatible reasoning"
)
