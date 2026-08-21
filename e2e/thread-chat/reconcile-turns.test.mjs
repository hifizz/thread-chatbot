/**
 * Tree/generation reconciliation regression:
 *   node --import tsx e2e/thread-chat/reconcile-turns.test.mjs
 */
import assert from "node:assert/strict"
import {
  assertCompletedMessageGenerationLinks,
  reconcileThreadChatTurns,
} from "../../app/thread-chat/generation/reconcile-turns.ts"

async function test(name, fn) {
  await fn()
  console.log(`PASS  ${name}`)
}

const user = (id, parentMessageId = null) => ({
  id,
  parentMessageId,
  role: "user",
  text: id,
  forks: [],
})
const assistant = (id, parentMessageId, generationId, status = "pending") => ({
  id,
  parentMessageId,
  role: "assistant",
  text: "",
  forks: [],
  generationId,
  status,
})

function state(messages, activeLeafMessageId) {
  return {
    schemaVersion: 2,
    threads: {
      main: {
        id: "main",
        modelId: "test/model",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages,
        activeLeafMessageId,
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 10,
    tick: 1,
  }
}

function generation({
  id = "g1",
  userMessage = user("u1"),
  assistantMessage = assistant("a1", userMessage.id, id),
  status = "running",
  isCurrent = true,
  result,
} = {}) {
  return {
    id,
    treeId: "tree",
    threadId: "main",
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    attempt: 1,
    isCurrent,
    status,
    updatedAt: "2026-01-01T00:00:00.000Z",
    result,
    turnSnapshot: {
      threadId: "main",
      assistantMessageIndex: 1,
      userMessage,
      assistantMessage,
      userParentMessageId: userMessage.parentMessageId,
      assistantParentMessageId: userMessage.id,
      activatesAssistantMessageId: assistantMessage.id,
    },
  }
}

await test("running generation restores missing assistant as background", () => {
  const reconciled = reconcileThreadChatTurns({
    state: state([user("u1")], "u1"),
    generations: [generation()],
  })
  const restored = reconciled.state.threads.main.messages.at(-1)
  assert.equal(restored.id, "a1")
  assert.equal(restored.parentMessageId, "u1")
  assert.equal(restored.backgroundGeneration, true)
  assert.equal(reconciled.state.threads.main.activeLeafMessageId, "a1")
  assert.deepEqual(reconciled.recoverableTurns, [])
})

await test("terminal result merges before orphan detection", () => {
  const g = generation({
    status: "completed",
    result: {
      version: 1,
      generationId: "g1",
      text: "最终答案",
      status: "done",
      artifactIds: [],
      artifacts: {},
    },
  })
  const reconciled = reconcileThreadChatTurns({
    state: state([user("u1")], "u1"),
    generations: [g],
  })
  assert.equal(reconciled.state.threads.main.messages.at(-1).text, "最终答案")
  assert.deepEqual(reconciled.recoverableTurns, [])
})

await test("empty pending assistant without generation is retained and recoverable", () => {
  const reconciled = reconcileThreadChatTurns({
    state: state([user("u1"), assistant("a1", "u1", undefined)], "a1"),
    generations: [],
  })
  const retained = reconciled.state.threads.main.messages.at(-1)
  assert.equal(retained.id, "a1")
  assert.equal(retained.status, "error")
  assert.deepEqual(reconciled.recoverableTurns, [
    {
      threadId: "main",
      userMessageId: "u1",
      assistantMessageId: "a1",
      reason: "missing_generation",
    },
  ])
})

await test("partial pending assistant without generation retains output but becomes recoverable", () => {
  const partial = {
    ...assistant("a1", "u1", undefined, "streaming"),
    text: "半截正文",
  }
  const reconciled = reconcileThreadChatTurns({
    state: state([user("u1"), partial], "a1"),
    generations: [],
  })
  const retained = reconciled.state.threads.main.messages.at(-1)
  assert.equal(retained.text, "半截正文")
  assert.equal(retained.status, "error")
  assert.equal(reconciled.recoverableTurns[0].assistantMessageId, "a1")
})

await test("active orphan user produces a missing-assistant recovery", () => {
  const reconciled = reconcileThreadChatTurns({
    state: state([user("u1")], "u1"),
    generations: [],
  })
  assert.deepEqual(reconciled.recoverableTurns, [
    {
      threadId: "main",
      userMessageId: "u1",
      reason: "missing_assistant",
    },
  ])
})

await test("repair does not override a later valid assistant selection", () => {
  const messages = [
    user("u1"),
    { ...assistant("a-old", "u1", "g-old", "done"), text: "旧版本" },
  ]
  const g = generation({
    assistantMessage: assistant("a-new", "u1", "g-new"),
    id: "g-new",
  })
  const reconciled = reconcileThreadChatTurns({
    state: state(messages, "a-old"),
    generations: [g],
  })
  assert.ok(
    reconciled.state.threads.main.messages.some(
      (message) => message.id === "a-new"
    )
  )
  assert.equal(reconciled.state.threads.main.activeLeafMessageId, "a-old")
})

await test("done assistant requires a completed generation linked by message id", () => {
  const completedState = state(
    [user("u1"), { ...assistant("a1", "u1", undefined, "done"), text: "答案" }],
    "a1"
  )
  assert.throws(() => assertCompletedMessageGenerationLinks(completedState, []))
  assert.throws(() =>
    assertCompletedMessageGenerationLinks(completedState, [
      generation({
        status: "completed",
        isCurrent: false,
        result: {
          version: 1,
          generationId: "g1",
          text: "旧答案",
          status: "done",
          artifactIds: [],
          artifacts: {},
        },
      }),
    ])
  )
  assert.doesNotThrow(() =>
    assertCompletedMessageGenerationLinks(completedState, [
      generation({
        status: "completed",
        result: {
          version: 1,
          generationId: "g1",
          text: "答案",
          status: "done",
          artifactIds: [],
          artifacts: {},
        },
      }),
    ])
  )
})

await test("completed-message link validation scales across large histories", () => {
  const turnCount = 20_000
  const messages = []
  const generations = []
  for (let index = 0; index < turnCount; index++) {
    const userMessage = user(`u-${index}`)
    const assistantMessage = {
      ...assistant(`a-${index}`, userMessage.id, `g-${index}`, "done"),
      text: "答案",
    }
    messages.push(userMessage, assistantMessage)
    generations.push(
      generation({
        id: `g-${index}`,
        userMessage,
        assistantMessage,
        status: "completed",
        result: {
          version: 1,
          generationId: `g-${index}`,
          text: "答案",
          status: "done",
          artifactIds: [],
          artifacts: {},
        },
      })
    )
  }
  assert.doesNotThrow(() =>
    assertCompletedMessageGenerationLinks(
      state(messages, `a-${turnCount - 1}`),
      generations
    )
  )
})
