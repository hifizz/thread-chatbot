import assert from "node:assert/strict"
import { buildChatToolSet } from "../../app/api/chat/tool-set.ts"

function build(overrides = {}) {
  return buildChatToolSet({
    researchMode: "answer",
    searchReady: true,
    ...overrides,
  })
}

const answer = build()
assert.equal(answer.webToolsEnabled, false)
assert.deepEqual(Object.keys(answer.tools).sort(), [
  "compareTable",
  "getWeather",
])

const fetch = build({ researchMode: "fetch" })
assert.equal(fetch.webToolsEnabled, true)
assert.deepEqual(Object.keys(fetch.tools).sort(), [
  "compareTable",
  "getWeather",
  "readUrl",
])

for (const researchMode of ["search", "research"]) {
  const web = build({ researchMode })
  assert.equal(web.webToolsEnabled, true)
  assert.deepEqual(Object.keys(web.tools).sort(), [
    "compareTable",
    "getWeather",
    "readUrl",
    "webSearch",
  ])
}

const unavailable = build({ researchMode: "research", searchReady: false })
assert.equal(unavailable.webToolsEnabled, false)
assert.deepEqual(Object.keys(unavailable.tools).sort(), [
  "compareTable",
  "getWeather",
])

const composed = build({
  researchMode: "fetch",
  frontendToolSet: { clientEcho: { kind: "frontend" } },
})
assert.equal(composed.webToolsEnabled, true)
assert.deepEqual(Object.keys(composed.tools), [
  "getWeather",
  "compareTable",
  "readUrl",
  "clientEcho",
])

console.log(
  "PASS  chat tool set composes surface, routed web, and frontend capabilities before exposure"
)
