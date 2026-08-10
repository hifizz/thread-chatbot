import assert from "node:assert/strict"
import test from "node:test"

import { appendServerForcedSearchResult } from "../../lib/chat/server-forced-search.ts"

test("服务端强制搜索把同一 call id、query 和结果注入模型上下文", () => {
  const original = [{ role: "user", content: "current Node.js LTS?" }]
  const output = {
    ok: true,
    status: "success",
    query: "current Node.js LTS",
    results: [
      {
        sourceId: "src_1",
        title: "Node.js releases",
        url: "https://nodejs.org/en/about/previous-releases",
        snippet: "Node.js 24 is Active LTS",
      },
    ],
    latencyMs: 12,
  }
  const messages = appendServerForcedSearchResult({
    messages: original,
    toolCallId: "call_1",
    toolName: "webSearch",
    query: output.query,
    output,
  })

  assert.equal(messages.length, 3)
  assert.deepEqual(messages[1].content[0], {
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "webSearch",
    input: { query: output.query },
  })
  assert.equal(messages[2].content[0].toolCallId, "call_1")
  assert.deepEqual(messages[2].content[0].output.value, output)
  assert.deepEqual(original, [{ role: "user", content: "current Node.js LTS?" }])
})
