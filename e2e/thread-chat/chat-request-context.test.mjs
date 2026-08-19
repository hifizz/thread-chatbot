import assert from "node:assert/strict"
import { DEFAULT_MODEL_ID } from "../../constants/model.ts"
import { prepareChatRequestContext } from "../../app/api/chat/request-context.ts"

const messages = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
]
function request(body) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function dependencies(overrides = {}) {
  return {
    currentUserId: async () => "user-1",
    getModel: (id) =>
      id === "known" || id === DEFAULT_MODEL_ID
        ? { id, name: `Model ${id}`, provider: "ark" }
        : undefined,
    modelConfigured: () => true,
    unbilledPreview: () => false,
    positiveBalance: async () => true,
    ...overrides,
  }
}

let parsedWithoutAuth = false
const unauthorized = await prepareChatRequestContext(
  {
    async json() {
      parsedWithoutAuth = true
      return {}
    },
  },
  dependencies({ currentUserId: async () => null })
)
assert.equal(unauthorized.kind, "response")
assert.equal(unauthorized.response.status, 401)
assert.equal(parsedWithoutAuth, false)

for (const modelId of [42, "missing"]) {
  const invalid = await prepareChatRequestContext(
    request({ messages, modelId }),
    dependencies()
  )
  assert.equal(invalid.kind, "response")
  assert.equal(invalid.response.status, 400)
  assert.deepEqual(await invalid.response.json(), {
    error: "未知或无效的模型。",
  })
}

const unconfigured = await prepareChatRequestContext(
  request({ messages, modelId: "known" }),
  dependencies({ modelConfigured: () => false })
)
assert.equal(unconfigured.kind, "response")
assert.equal(unconfigured.response.status, 400)
assert.match((await unconfigured.response.json()).error, /Model known.*未配置/)

const insufficient = await prepareChatRequestContext(
  request({ messages, modelId: "known" }),
  dependencies({ positiveBalance: async () => false })
)
assert.equal(insufficient.kind, "response")
assert.equal(insufficient.response.status, 402)

let previewBalanceChecks = 0
const preview = await prepareChatRequestContext(
  request({
    messages,
    modelId: "known",
    deepResearch: true,
    threadChat: { marker: true },
    id: "linear-1",
    tools: { clientTool: {} },
  }),
  dependencies({
    unbilledPreview: () => true,
    positiveBalance: async () => {
      previewBalanceChecks++
      return false
    },
  })
)
assert.equal(preview.kind, "ready")
assert.equal(previewBalanceChecks, 0)
assert.equal(preview.userId, "user-1")
assert.equal(preview.modelId, "known")
assert.equal(preview.isUnbilledPreview, true)
assert.deepEqual(preview.messages, messages)
assert.equal(preview.deepResearch, true)
assert.deepEqual(preview.threadChat, { marker: true })
assert.equal(preview.linearThreadId, "linear-1")
assert.deepEqual(Object.keys(preview.tools), ["clientTool"])

const defaultModel = await prepareChatRequestContext(
  request({ messages }),
  dependencies()
)
assert.equal(defaultModel.kind, "ready")
assert.equal(defaultModel.modelId, DEFAULT_MODEL_ID)

console.log(
  "PASS  chat request context owns auth, body parsing, model validity/configuration, preview bypass, and balance gating"
)
