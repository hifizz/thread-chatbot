/**
 * Immutable latest-turn patch regression:
 *   node --import tsx e2e/thread-chat/regeneration-patch.test.mjs
 */
import assert from "node:assert/strict"
import { prepareRegenerationPatch } from "../../app/thread-chat/core/regeneration.ts"

async function test(name, fn) {
  await fn()
  console.log(`PASS  ${name}`)
}

function state() {
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
        messages: [
          {
            id: "u1",
            parentMessageId: null,
            role: "user",
            text: "原问题",
            quote: { text: "引用" },
            forks: [{ text: "用户分支", num: 1, threadId: "b1", depth: 1 }],
          },
          {
            id: "a1",
            parentMessageId: "u1",
            role: "assistant",
            text: "原答案",
            forks: [{ text: "答案分支", num: 2, threadId: "b2", depth: 1 }],
            artifactIds: ["artifact-a"],
            generationId: "g-old",
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
    footnoteCounter: 2,
    seq: 10,
    tick: 1,
  }
}

await test("assistant regeneration appends a sibling without touching source", () => {
  const source = state()
  const before = structuredClone(source)
  const patch = prepareRegenerationPatch(source, {
    threadId: "main",
    userMessageId: "u1",
    assistantMessageId: "a2",
    generationId: "g-new",
    intent: { kind: "regenerate-assistant", sourceAssistantMessageId: "a1" },
  })
  assert.deepEqual(source, before)
  assert.equal(patch.addedMessages.length, 1)
  assert.equal(patch.addedMessages[0].parentMessageId, "u1")
  assert.equal(patch.nextActiveLeafMessageId, "a2")
  assert.deepEqual(source.artifacts, before.artifacts)
})

await test("edit appends sibling user + child and only copies quote semantics", () => {
  const source = state()
  const patch = prepareRegenerationPatch(source, {
    threadId: "main",
    userMessageId: "u2",
    assistantMessageId: "a2",
    generationId: "g-new",
    intent: {
      kind: "edit-last-user",
      sourceUserMessageId: "u1",
      text: "  新问题  ",
    },
  })
  assert.equal(patch.addedMessages[0].parentMessageId, null)
  assert.equal(patch.addedMessages[0].text, "新问题")
  assert.deepEqual(patch.addedMessages[0].quote, { text: "引用" })
  assert.deepEqual(patch.addedMessages[0].forks, [])
  assert.equal(patch.addedMessages[1].parentMessageId, "u2")
})

await test("orphan retry reuses user but creates a fresh assistant", () => {
  const source = state()
  source.threads.main.messages = [source.threads.main.messages[0]]
  source.threads.main.activeLeafMessageId = "u1"
  const patch = prepareRegenerationPatch(source, {
    threadId: "main",
    userMessageId: "u1",
    assistantMessageId: "a2",
    generationId: "g-new",
    intent: { kind: "retry-orphan-user" },
  })
  assert.deepEqual(
    patch.addedMessages.map((message) => message.id),
    ["a2"]
  )
  assert.equal(patch.addedMessages[0].parentMessageId, "u1")
})

await test("historical source, duplicate IDs and non-empty orphan are rejected", () => {
  const source = state()
  source.threads.main.messages.push(
    {
      id: "u-last",
      parentMessageId: "a1",
      role: "user",
      text: "下一轮",
      forks: [],
    },
    {
      id: "a-last",
      parentMessageId: "u-last",
      role: "assistant",
      text: "下一答",
      forks: [],
      status: "done",
    }
  )
  source.threads.main.activeLeafMessageId = "a-last"
  assert.equal(
    prepareRegenerationPatch(source, {
      threadId: "main",
      userMessageId: "u1",
      assistantMessageId: "a2",
      generationId: "g-new",
      intent: {
        kind: "regenerate-assistant",
        sourceAssistantMessageId: "a1",
      },
    }),
    null
  )

  const current = state()
  assert.equal(
    prepareRegenerationPatch(current, {
      threadId: "main",
      userMessageId: "u1",
      assistantMessageId: "a1",
      generationId: "g-new",
      intent: {
        kind: "regenerate-assistant",
        sourceAssistantMessageId: "a1",
      },
    }),
    null
  )
  assert.equal(
    prepareRegenerationPatch(current, {
      threadId: "main",
      userMessageId: "u1",
      assistantMessageId: "a2",
      generationId: "g-new",
      intent: { kind: "retry-orphan-user" },
    }),
    null
  )
})
