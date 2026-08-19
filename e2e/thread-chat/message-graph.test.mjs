/**
 * Message DAG migration/selectors regression:
 *   node --import tsx e2e/thread-chat/message-graph.test.mjs
 */
import assert from "node:assert/strict"
import {
  activeMessagePath,
  activePathArtifacts,
  assistantTurnAlternatives,
  childThreadSourceProvenance,
  messagePathTo,
} from "../../app/thread-chat/core/message-graph.ts"
import { parseThreadTreeState } from "../../app/thread-chat/core/message-graph.ts"
import { collectInherited } from "../../app/thread-chat/core/selectors.ts"
import { compileThreadChatMessages } from "../../lib/thread-chat/application/compile-thread-chat-messages.ts"

async function test(name, fn) {
  await fn()
  console.log(`PASS  ${name}`)
}

function legacyState() {
  return {
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
          { id: "u1", role: "user", text: "问题", forks: [] },
          {
            id: "a1",
            role: "assistant",
            text: "答案",
            forks: [],
            artifactIds: ["artifact-a"],
          },
        ],
        lastActive: 1,
      },
    },
    artifacts: {
      "artifact-a": {
        id: "artifact-a",
        title: "A",
        kind: "markdown",
        content: "A",
        sourceThreadId: "main",
      },
    },
    artifactOrder: ["artifact-a"],
    recents: [],
    footnoteCounter: 0,
    seq: 2,
    tick: 1,
  }
}

function graphState() {
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
        children: ["child"],
        messages: [
          {
            id: "u1",
            parentMessageId: null,
            role: "user",
            text: "原问题",
            forks: [],
          },
          {
            id: "a1",
            parentMessageId: "u1",
            role: "assistant",
            text: "版本 A",
            forks: [],
            artifactIds: ["artifact-a"],
          },
          {
            id: "a2",
            parentMessageId: "u1",
            role: "assistant",
            text: "版本 B",
            forks: [],
            artifactIds: ["artifact-b"],
          },
          {
            id: "u2",
            parentMessageId: null,
            role: "user",
            text: "编辑问题",
            forks: [],
          },
          {
            id: "a3",
            parentMessageId: "u2",
            role: "assistant",
            text: "版本 C",
            forks: [],
          },
        ],
        activeLeafMessageId: "a2",
        lastActive: 1,
      },
      child: {
        id: "child",
        modelId: "test/model",
        parentId: "main",
        depth: 1,
        title: "来自 A",
        anchorText: "版本 A",
        forkFromMsgId: "a1",
        footnote: 1,
        children: [],
        messages: [],
        activeLeafMessageId: null,
        lastActive: 1,
      },
    },
    artifacts: {
      "artifact-a": {
        id: "artifact-a",
        title: "A",
        kind: "markdown",
        content: "A",
        sourceThreadId: "main",
        sourceMessageId: "a1",
      },
      "artifact-b": {
        id: "artifact-b",
        title: "B",
        kind: "markdown",
        content: "B",
        sourceThreadId: "main",
        sourceMessageId: "a2",
      },
    },
    artifactOrder: ["artifact-a", "artifact-b"],
    recents: [],
    footnoteCounter: 1,
    seq: 10,
    tick: 1,
  }
}

await test("legacy linear trees are rejected and schema v2 is idempotent", () => {
  assert.throws(() => parseThreadTreeState(legacyState()))
  const state = graphState()
  assert.deepEqual(parseThreadTreeState(state), state)
})

await test("active and exact-source paths do not follow creation order", () => {
  const state = graphState()
  assert.deepEqual(
    activeMessagePath(state.threads.main).map((message) => message.id),
    ["u1", "a2"]
  )
  assert.deepEqual(
    messagePathTo(state.threads.main, "a1").map((message) => message.id),
    ["u1", "a1"]
  )
  assert.deepEqual(
    collectInherited(state, state.threads.child).map((message) => message.id),
    ["u1", "a1"]
  )
})

await test("turn alternatives include regenerate and edited-user siblings", () => {
  const alternatives = assistantTurnAlternatives(
    graphState().threads.main,
    "a2"
  )
  assert.deepEqual(
    alternatives.map((message) => message.id),
    ["a1", "a2", "a3"]
  )
})

await test("inactive child source and active artifacts preserve provenance", () => {
  const state = graphState()
  assert.deepEqual(
    activePathArtifacts(state).map((artifact) => artifact.id),
    ["artifact-b"]
  )
  assert.deepEqual(childThreadSourceProvenance(state, "child"), {
    sourceThreadId: "main",
    sourceMessageId: "a1",
    isOnActivePath: false,
    alternativeIndex: 0,
    alternativeCount: 3,
  })
})

await test("model context follows active path and exact child source", () => {
  const state = graphState()
  const mainContext = compileThreadChatMessages({
    state,
    threadId: "main",
    excludeAssistantMessageId: "none",
  })
  assert.deepEqual(
    mainContext.map((message) => message.id),
    ["u1", "a2"]
  )
  assert.match(mainContext[1].parts[0].text, /版本 B/)
  assert.match(mainContext[1].parts[0].text, /Markdown Artifact: B/)

  const childContext = compileThreadChatMessages({
    state,
    threadId: "child",
    excludeAssistantMessageId: "none",
  })
  assert.deepEqual(
    childContext.map((message) => message.id),
    ["inh-u1", "inh-a1"]
  )
  assert.match(childContext[1].parts[0].text, /版本 A/)
  assert.match(childContext[1].parts[0].text, /Markdown Artifact: A/)
  assert.doesNotMatch(childContext[1].parts[0].text, /版本 B/)
})

for (const [name, mutate] of [
  [
    "duplicate ids",
    (state) =>
      state.threads.main.messages.push({ ...state.threads.main.messages[0] }),
  ],
  [
    "missing parent",
    (state) => (state.threads.main.messages[1].parentMessageId = "missing"),
  ],
  ["cycle", (state) => (state.threads.main.messages[0].parentMessageId = "a1")],
  [
    "missing active leaf",
    (state) => (state.threads.main.activeLeafMessageId = "missing"),
  ],
  [
    "missing artifact source",
    (state) => delete state.artifacts["artifact-a"].sourceMessageId,
  ],
  [
    "unreferenced artifact",
    (state) => (state.threads.main.messages[1].artifactIds = []),
  ],
]) {
  await test(`schema v2 rejects ${name}`, () => {
    const state = graphState()
    mutate(state)
    assert.throws(() => parseThreadTreeState(state))
  })
}
