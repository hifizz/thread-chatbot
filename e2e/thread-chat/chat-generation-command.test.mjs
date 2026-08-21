import assert from "node:assert/strict"
import { requestChatGeneration } from "../../app/thread-chat/net/commands/chat-generation-command.ts"

const body = { messages: [{ role: "user", parts: [] }] }
const controller = new AbortController()
let request
const streamed = await requestChatGeneration(
  { body, signal: controller.signal },
  {
    async fetch(url, init) {
      request = { url, init }
      return new Response("data: ok\n\n", {
        status: 200,
        headers: { "x-thread-tree-revision": "12" },
      })
    },
    unauthorized() {
      assert.fail("successful stream must not recover auth")
    },
  }
)
assert.equal(streamed.kind, "stream")
assert.equal(streamed.revision, 12)
assert.equal(request.url, "/api/chat")
assert.equal(request.init.method, "POST")
assert.equal(request.init.signal, controller.signal)
assert.deepEqual(JSON.parse(request.init.body), body)

const invalidRevision = await requestChatGeneration(
  { body, signal: controller.signal },
  {
    fetch: async () =>
      new Response("data: ok\n\n", {
        headers: { "x-thread-tree-revision": "12.5" },
      }),
    unauthorized() {},
  }
)
assert.equal(invalidRevision.kind, "stream")
assert.equal(invalidRevision.revision, null)

const replayed = await requestChatGeneration(
  { body, signal: controller.signal },
  {
    fetch: async () => new Response(null, { status: 202 }),
    unauthorized() {},
  }
)
assert.deepEqual(replayed, { kind: "replayed" })

const rejected = await requestChatGeneration(
  { body, signal: controller.signal },
  {
    fetch: async () =>
      Response.json(
        { error: { code: "generation_conflict", message: "冲突" } },
        { status: 409 }
      ),
    unauthorized() {},
  }
)
assert.deepEqual(rejected, {
  kind: "rejected",
  failure: { ok: false, code: "generation_conflict", message: "冲突" },
})

const invalidIdentity = await requestChatGeneration(
  { body, signal: controller.signal },
  {
    fetch: async () =>
      Response.json(
        {
          error: {
            code: "invalid_generation_identity",
            message: "请刷新页面后重试",
          },
        },
        { status: 400 }
      ),
    unauthorized() {},
  }
)
assert.deepEqual(invalidIdentity, {
  kind: "rejected",
  failure: {
    ok: false,
    code: "invalid_generation_identity",
    message: "请刷新页面后重试",
  },
})

const stringError = await requestChatGeneration(
  { body, signal: controller.signal },
  {
    fetch: async () =>
      Response.json({ error: "额度不足，请充值后再试。" }, { status: 402 }),
    unauthorized() {},
  }
)
assert.deepEqual(stringError, {
  kind: "rejected",
  failure: {
    ok: false,
    code: "network_error",
    message: "额度不足，请充值后再试。",
  },
})

let unauthorizedCalls = 0
const unauthorized = await requestChatGeneration(
  { body, signal: controller.signal },
  {
    fetch: async () => new Response(null, { status: 401 }),
    unauthorized() {
      unauthorizedCalls++
    },
  }
)
assert.deepEqual(unauthorized, {
  kind: "rejected",
  failure: {
    ok: false,
    code: "unauthorized",
    message: "登录已失效，正在跳转登录…",
  },
})
assert.equal(unauthorizedCalls, 1)

const emptySuccess = await requestChatGeneration(
  { body, signal: controller.signal },
  {
    fetch: async () => new Response(null, { status: 200 }),
    unauthorized() {},
  }
)
assert.deepEqual(emptySuccess, {
  kind: "rejected",
  failure: {
    ok: false,
    code: "network_error",
    message: "请求失败（HTTP 200）",
  },
})

console.log(
  "PASS  chat generation command owns POST, replay, auth recovery, error payloads, stream body, and revision parsing"
)
