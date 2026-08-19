import assert from "node:assert/strict"
import { requestGenerationStop } from "../../app/thread-chat/net/stop-generation-command.ts"

const generationId = "11111111-1111-4111-8111-111111111111"
let request
const accepted = await requestGenerationStop(generationId, {
  async fetch(url, init) {
    request = { url, init }
    return new Response(null, { status: 202 })
  },
  logError() {
    assert.fail("accepted stop must not log")
  },
})
assert.deepEqual(accepted, { ok: true })
assert.deepEqual(request, {
  url: `/api/branch-generations/${generationId}/stop`,
  init: { method: "POST" },
})

const rejected = await requestGenerationStop(generationId, {
  fetch: async () => new Response(null, { status: 409 }),
  logError() {},
})
assert.deepEqual(rejected, {
  ok: false,
  message: "停止失败（HTTP 409），生成仍在继续",
})

const logged = []
const offline = new Error("offline")
const network = await requestGenerationStop(generationId, {
  fetch: async () => {
    throw offline
  },
  logError(message, error) {
    logged.push([message, error])
  },
})
assert.deepEqual(network, {
  ok: false,
  message: "停止失败，生成仍在继续",
})
assert.deepEqual(logged, [["[thread-chat] Stop 请求失败", offline]])

console.log(
  "PASS  stop generation command owns POST transport and stable HTTP/network failures"
)
