/**
 * Headless message-action command regression:
 *   node --import tsx e2e/thread-chat/message-actions-controller.test.mjs
 */
import assert from "node:assert/strict"
import { createThreadStore } from "../../app/thread-chat/core/store.ts"
import { createChatController } from "../../app/thread-chat/net/chat-controller.ts"
import { setKnownTreeRevision } from "../../app/thread-chat/net/persist.ts"

const treeId = "11111111-1111-4111-8111-111111111111"

function seed() {
  return {
    schemaVersion: 2,
    threads: {
      main: {
        id: "main",
        modelId: "glm-5.2",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages: [
          {
            id: "u1",
            parentMessageId: null,
            role: "user",
            text: "原问题",
            quote: { text: "原引用" },
            forks: [],
          },
          {
            id: "a1",
            parentMessageId: "u1",
            role: "assistant",
            text: "原答案",
            forks: [],
            artifactIds: ["artifact-a"],
            generationId: "22222222-2222-4222-8222-222222222222",
            status: "done",
          },
          {
            id: "a2",
            parentMessageId: "u1",
            role: "assistant",
            text: "另一个版本",
            forks: [],
            status: "done",
          },
        ],
        activeLeafMessageId: "a1",
        lastActive: 1,
      },
    },
    artifacts: {
      "artifact-a": {
        id: "artifact-a",
        title: "旧产物",
        kind: "markdown",
        content: "old",
        sourceThreadId: "main",
        sourceMessageId: "a1",
      },
    },
    artifactOrder: ["artifact-a"],
    recents: [],
    footnoteCounter: 0,
    seq: 4,
    tick: 1,
  }
}

function controllerWith(fetchImpl) {
  const store = createThreadStore(seed())
  const previousFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  const controller = createChatController(store, {
    treeId,
    persistNow: async () => {},
  })
  return {
    store,
    controller,
    restore() {
      controller.detachAll()
      globalThis.fetch = previousFetch
    },
  }
}

async function test(name, fn) {
  await fn()
  console.log(`PASS  ${name}`)
}

await test("accepted regeneration appends a sibling and preserves source", async () => {
  const harness = controllerWith(async (input) => {
    assert.equal(input, "/api/chat")
    return new Response(null, { status: 202 })
  })
  try {
    const result = await harness.controller.retryAssistant("main", "a1")
    assert.equal(result.ok, true)
    const thread = harness.store.getState().threads.main
    assert.equal(thread.messages.length, 4)
    assert.equal(thread.activeLeafMessageId, result.assistantMessageId)
    assert.equal(
      thread.messages.find((message) => message.id === "a1").text,
      "原答案"
    )
    assert.equal(
      harness.store.getState().artifacts["artifact-a"].sourceMessageId,
      "a1"
    )
  } finally {
    harness.restore()
  }
})

await test("rejected edit leaves the local graph byte-for-byte unchanged", async () => {
  const harness = controllerWith(async () =>
    Response.json(
      { error: { code: "generation_conflict", message: "冲突" } },
      { status: 409 }
    )
  )
  try {
    const before = structuredClone(harness.store.getState())
    const result = await harness.controller.editAndRegenerate(
      "main",
      "u1",
      "编辑后的问题"
    )
    assert.deepEqual(result, {
      ok: false,
      code: "generation_conflict",
      message: "冲突",
    })
    assert.deepEqual(harness.store.getState(), before)
  } finally {
    harness.restore()
  }
})

await test("accepted edit preserves the old turn and quote on the new user sibling", async () => {
  const harness = controllerWith(
    async () => new Response(null, { status: 202 })
  )
  try {
    const result = await harness.controller.editAndRegenerate(
      "main",
      "u1",
      "编辑后的问题"
    )
    assert.equal(result.ok, true)
    const thread = harness.store.getState().threads.main
    const nextUser = thread.messages.find(
      (message) => message.id === result.userMessageId
    )
    assert.equal(
      thread.messages.find((message) => message.id === "u1").text,
      "原问题"
    )
    assert.equal(nextUser.text, "编辑后的问题")
    assert.deepEqual(nextUser.quote, { text: "原引用" })
    assert.equal(thread.activeLeafMessageId, result.assistantMessageId)
  } finally {
    harness.restore()
  }
})

await test("variant conflicts do not move the local leaf; success does", async () => {
  let conflict = true
  const harness = controllerWith(async (input, init) => {
    assert.match(String(input), /active-leaf$/)
    const body = JSON.parse(init.body)
    assert.equal(body.baseRevision, conflict ? 7 : 8)
    return conflict
      ? Response.json(
          {
            error: {
              code: "tree_revision_conflict",
              message: "该对话已更新",
            },
          },
          { status: 409 }
        )
      : Response.json({ revision: 9 })
  })
  try {
    setKnownTreeRevision(treeId, 7)
    const rejected = await harness.controller.switchTurnVariant("main", "a2")
    assert.equal(rejected.ok, false)
    assert.equal(
      harness.store.getState().threads.main.activeLeafMessageId,
      "a1"
    )

    conflict = false
    setKnownTreeRevision(treeId, 8)
    const accepted = await harness.controller.switchTurnVariant("main", "a2")
    assert.equal(accepted.ok, true)
    assert.equal(
      harness.store.getState().threads.main.activeLeafMessageId,
      "a2"
    )
  } finally {
    harness.restore()
  }
})

await test("feedback command sends the exact message/value pair", async () => {
  let request
  const harness = controllerWith(async (input, init) => {
    request = { input: String(input), init }
    return Response.json({ ok: true })
  })
  try {
    await harness.controller.submitFeedback(
      "main",
      "22222222-2222-4222-8222-222222222222",
      "negative"
    )
    assert.equal(
      request.input,
      `/api/branch-trees/${treeId}/messages/22222222-2222-4222-8222-222222222222/feedback`
    )
    assert.deepEqual(JSON.parse(request.init.body), {
      threadId: "main",
      feedback: "negative",
    })

    await harness.controller.submitFeedback(
      "main",
      "22222222-2222-4222-8222-222222222222",
      null
    )
    assert.deepEqual(JSON.parse(request.init.body), {
      threadId: "main",
      feedback: null,
    })
  } finally {
    harness.restore()
  }
})
