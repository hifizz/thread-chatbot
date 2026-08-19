import assert from "node:assert/strict"
import { switchActiveLeaf } from "../../app/thread-chat/net/switch-active-leaf-command.ts"

const input = {
  treeId: "11111111-1111-4111-8111-111111111111",
  threadId: "main",
  assistantMessageId: "a2",
  baseRevision: 7,
}
let request
const success = await switchActiveLeaf(input, {
  async fetch(url, init) {
    request = { url, init }
    return Response.json({
      revision: 8,
      thread: { id: "main", activeLeafMessageId: "a2" },
    })
  },
})
assert.deepEqual(success, {
  ok: true,
  threadId: "main",
  assistantMessageId: "a2",
  revision: 8,
})
assert.equal(
  request.url,
  "/api/branch-trees/11111111-1111-4111-8111-111111111111/active-leaf"
)
assert.equal(request.init.method, "PATCH")
assert.deepEqual(JSON.parse(request.init.body), {
  threadId: "main",
  assistantMessageId: "a2",
  baseRevision: 7,
})

const conflict = await switchActiveLeaf(input, {
  fetch: async () =>
    Response.json(
      {
        error: {
          code: "tree_revision_conflict",
          message: "该对话已更新",
        },
      },
      { status: 409 }
    ),
})
assert.deepEqual(conflict, {
  ok: false,
  code: "tree_revision_conflict",
  message: "该对话已更新",
})

const invalidSuccess = await switchActiveLeaf(input, {
  fetch: async () => Response.json({ revision: "8" }),
})
assert.deepEqual(invalidSuccess, {
  ok: false,
  code: "network_error",
  message: "服务端未返回新的树修订号",
})

const invalidError = await switchActiveLeaf(input, {
  fetch: async () => new Response("upstream", { status: 502 }),
})
assert.deepEqual(invalidError, {
  ok: false,
  code: "network_error",
  message: "切换回复版本失败",
})

const network = await switchActiveLeaf(input, {
  fetch: async () => {
    throw new Error("offline")
  },
})
assert.deepEqual(network, {
  ok: false,
  code: "network_error",
  message: "网络请求失败，请重试",
})

console.log(
  "PASS  switch active leaf command owns PATCH transport, shared contracts, and network fallbacks"
)
