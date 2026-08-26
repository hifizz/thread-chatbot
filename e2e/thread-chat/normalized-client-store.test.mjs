import assert from "node:assert/strict"
import { createConversationStore } from "../../app/thread-chat/core/store.ts"
import {
  selectAllMessageEntities,
  selectSourceProvenance,
  selectThreadTree,
  selectVisibleMessages,
} from "../../app/thread-chat/core/selectors.ts"
import {
  projectConversationTree,
  projectMessageDTO,
} from "../../app/thread-chat/core/projections.ts"
import {
  replayThreadChatUIMessage,
  ThreadChatUIMessageReducer,
} from "../../app/thread-chat/net/stream/ui-message-reducer.ts"
import { subscribeToMessageStream } from "../../app/thread-chat/net/stream/sse-client.ts"
import { startTerminalPoller } from "../../app/thread-chat/net/stream/terminal-poller.ts"
import {
  sanitizeWorkspaceState,
  saveWorkspaceState,
} from "../../app/thread-chat/net/persistence/workspace-state.ts"
import { createConversationCommands } from "../../app/thread-chat/net/commands/conversation-commands.ts"

const stamp = "2026-08-26T00:00:00.000Z"

function project(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    rootThreadId: "00000000-0000-4000-8000-000000000002",
    autoTitle: "测试项目",
    customTitle: null,
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  }
}

function thread(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    projectId: project().id,
    parentId: null,
    forkMessageId: null,
    forkContext: [],
    forkAnchor: null,
    anchorText: null,
    footnote: null,
    depth: 0,
    modelId: "test/model",
    autoTitle: "主线",
    customTitle: null,
    titleGenerationAttempted: true,
    titleGenerated: true,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  }
}

function message(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    projectId: project().id,
    threadId: thread().id,
    sequence: 1,
    role: "assistant",
    parts: [{ type: "text", text: "A" }],
    status: "failed",
    modelId: "test/model",
    replacesMessageId: null,
    supersededAt: null,
    feedback: null,
    error: { code: "MODEL_ERROR", message: "失败" },
    createdAt: stamp,
    updatedAt: stamp,
    finishedAt: stamp,
    ...overrides,
  }
}

function bootstrap(overrides = {}) {
  return {
    project: project(),
    threads: [thread()],
    messages: [message()],
    artifacts: [],
    activeGenerationIds: [],
    ...overrides,
  }
}

function sseResponse(events) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        controller.close()
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  )
}

async function testStoreAndSelectors() {
  const source = message({ supersededAt: stamp })
  const current = message({
    id: "00000000-0000-4000-8000-000000000004",
    sequence: 2,
    replacesMessageId: source.id,
    status: "completed",
    error: null,
    parts: [{ type: "text", text: "B" }],
  })
  const child = thread({
    id: "00000000-0000-4000-8000-000000000005",
    parentId: thread().id,
    forkMessageId: source.id,
    forkContext: [source.id],
    forkAnchor: {
      quote: { exact: "A", prefix: "", suffix: "" },
    },
    anchorText: "A",
    footnote: 1,
    depth: 1,
  })
  const store = createConversationStore({
    bootstrap: bootstrap({
      threads: [thread(), child],
      messages: [source, current],
    }),
  })
  assert.deepEqual(
    selectVisibleMessages(store.getState(), thread().id).map((row) => row.id),
    [current.id]
  )
  assert.equal(
    selectAllMessageEntities(store.getState(), thread().id).length,
    2
  )
  assert.equal(
    selectSourceProvenance(store.getState(), child.id)?.message?.id,
    source.id
  )
  assert.deepEqual(
    selectThreadTree(store.getState()).map((row) => row.id),
    [thread().id, child.id]
  )
  const tree = projectConversationTree(store.getState())
  assert.ok(tree.threads[child.id], "旧来源被 supersede 后子分支仍可投影")
  assert.equal(tree.threads[thread().id].messages.length, 1)
}

async function testAiSdkReducer() {
  const reducer = new ThreadChatUIMessageReducer({
    id: "assistant",
    role: "assistant",
    parts: [],
  })
  reducer.push({
    type: "text-start",
    id: "text-1",
  })
  reducer.push({
    type: "text-delta",
    id: "text-1",
    delta: "完整 parts",
  })
  reducer.push({
    type: "text-end",
    id: "text-1",
  })
  const uiMessage = await reducer.flush()
  assert.equal(uiMessage.parts[0].text, "完整 parts")
  assert.equal(uiMessage.parts[0].state, "done")
  reducer.close()

  const history = [
    { seq: 1, chunk: { type: "text-start", id: "late-text" } },
    {
      seq: 2,
      chunk: { type: "text-delta", id: "late-text", delta: "半成" },
    },
  ]
  const resumed = await replayThreadChatUIMessage({
    snapshot: {
      id: "late-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "半成", state: "streaming" }],
    },
    replay: history,
  })
  resumed.push({
    type: "text-delta",
    id: "late-text",
    delta: "品",
  })
  resumed.push({ type: "text-end", id: "late-text" })
  const completed = await resumed.flush()
  assert.equal(completed.parts[0].text, "半成品")
  resumed.close()

  const progress = {
    type: "data-artifact-progress",
    id: "artifact-progress:tool-1",
    transient: true,
    data: {
      toolCallId: "tool-1",
      phase: "streaming",
      characterCount: 12,
      lineCount: 2,
      headings: [],
    },
  }
  const progressReducer = await replayThreadChatUIMessage({
    snapshot: {
      id: "artifact-assistant",
      role: "assistant",
      parts: [progress],
    },
    replay: [{ seq: 1, chunk: progress }],
  })
  assert.equal(
    progressReducer.current().parts[0].type,
    "data-artifact-progress"
  )
  progressReducer.close()

  const abortedReducer = new ThreadChatUIMessageReducer({
    id: "aborted-assistant",
    role: "assistant",
    parts: [],
  })
  abortedReducer.push({
    type: "abort",
    reason: "user-stop",
  })
  const afterAbort = await abortedReducer.flush()
  assert.deepEqual(afterAbort.parts, [])
  abortedReducer.close()
}

async function testOneShotSse() {
  let calls = 0
  const events = []
  const terminal = message({ status: "completed", error: null })
  const subscription = subscribeToMessageStream({
    url: "/stream",
    fetch: async () => {
      calls += 1
      return sseResponse([
        {
          type: "snapshot",
          message: { id: terminal.id, role: "assistant", parts: [] },
          throughSeq: 0,
          replay: [],
        },
        { type: "heartbeat", at: stamp },
        { type: "terminal", message: terminal },
      ])
    },
    onEvent: (event) => events.push(event.type),
  })
  await subscription.closed
  assert.equal(calls, 1, "SSE 客户端不得自动重连")
  assert.deepEqual(events, ["snapshot", "heartbeat", "terminal"])
}

async function testTerminalPoller() {
  const seen = []
  let polls = 0
  const terminal = message({ status: "stopped", error: null })
  const poller = startTerminalPoller({
    messageId: terminal.id,
    delays: [0],
    wait: async () => undefined,
    async getMessage() {
      polls += 1
      return polls === 1
        ? message({ status: "generating", finishedAt: null, error: null })
        : terminal
    },
    onGenerating: (value) => seen.push(value.status),
    onTerminal: (value) => seen.push(value.status),
  })
  assert.equal((await poller.finished)?.status, "stopped")
  assert.deepEqual(seen, ["generating", "stopped"])
}

async function testOptimisticRollbackIsolation() {
  const store = createConversationStore({ bootstrap: bootstrap() })
  const original = store.getState().messagesById[message().id]
  store.getState().beginOptimisticCommand("feedback", (snapshot) => ({
    messagesById: {
      ...snapshot.messagesById,
      [original.id]: { ...original, feedback: "up" },
    },
  }))
  store.getState().beginOptimisticCommand("rename", (snapshot) => ({
    project: { ...snapshot.project, customTitle: "保留这个并发变更" },
  }))
  store.getState().rollbackOptimisticCommand("feedback")
  assert.equal(store.getState().messagesById[original.id].feedback, null)
  assert.equal(store.getState().project.customTitle, "保留这个并发变更")
}

async function testRetryABC() {
  const a = message()
  const store = createConversationStore({
    bootstrap: bootstrap({ messages: [a] }),
  })
  const ids = [
    "00000000-0000-4000-8000-000000000101",
    "00000000-0000-4000-8000-000000000102",
    "00000000-0000-4000-8000-000000000103",
    "00000000-0000-4000-8000-000000000104",
  ]
  const accepted = (assistantMessage) => ({
    project: project(),
    thread: thread(),
    assistantMessage,
    streamUrl: `/stream/${assistantMessage.id}`,
  })
  const client = {
    async retryMessage(sourceId, command) {
      const source = store.getState().messagesById[sourceId]
      const replacement = message({
        id: command.assistantMessageId,
        sequence: source.sequence + 1,
        status: "generating",
        error: null,
        finishedAt: null,
        replacesMessageId: sourceId,
        parts: [],
      })
      return { ok: true, replayed: false, data: accepted(replacement) }
    },
    async getMessage(id) {
      return store.getState().messagesById[id]
    },
  }
  const commands = createConversationCommands({
    store,
    client,
    networkAttempts: 1,
    createId: () => ids.shift(),
    fetch: async (url) =>
      sseResponse([
        {
          type: "terminal",
          message: message({
            id: String(url).split("/").at(-1),
            status: "failed",
          }),
        },
      ]),
  })
  const retryB = await commands.retryMessage({
    messageId: a.id,
    modelId: "test/model",
  })
  const bId = retryB.command.assistantMessageId
  await retryB.connection.finished
  const retryC = await commands.retryMessage({
    messageId: bId,
    modelId: "test/model",
  })
  const cId = retryC.command.assistantMessageId
  assert.equal(store.getState().messagesById[a.id].status, "failed")
  assert.equal(store.getState().messagesById[a.id].supersededAt !== null, true)
  assert.equal(store.getState().messagesById[bId].status, "failed")
  assert.equal(store.getState().messagesById[bId].supersededAt !== null, true)
  assert.equal(store.getState().messagesById[cId].replacesMessageId, bId)
  commands.dispose()
}

async function testPartsProjectionAndWorkspaceIsolation() {
  const artifact = {
    id: "00000000-0000-4000-8000-000000000201",
    projectId: project().id,
    sourceMessageId: message().id,
    kind: "markdown",
    title: "报告",
    content: "# 报告",
    language: null,
    metadata: {},
    createdAt: stamp,
    updatedAt: stamp,
  }
  const rich = message({
    parts: [
      { type: "reasoning", text: "reason" },
      { type: "text", text: "正文" },
      {
        type: "data-research-activity",
        id: "activity",
        data: {
          toolCallId: "search",
          kind: "search",
          status: "completed",
          query: "test",
          sources: [],
        },
      },
      { type: "source-url", sourceId: "s", url: "https://example.com" },
      { type: "file", mediaType: "text/plain", url: "https://example.com/a" },
    ],
    status: "completed",
    error: null,
  })
  const store = createConversationStore({
    bootstrap: bootstrap({ messages: [rich], artifacts: [artifact] }),
  })
  const projected = projectMessageDTO({
    state: store.getState(),
    message: rich,
    parentMessageId: null,
  })
  assert.equal(projected.text, "正文")
  assert.equal(projected.webResearch.length, 1)
  assert.deepEqual(projected.artifactIds, [artifact.id])
  assert.equal(projected.uiParts.length, 5)

  let saved = ""
  saveWorkspaceState(
    {
      setItem(_key, value) {
        saved = value
      },
    },
    project().id,
    store.getState().workspace
  )
  assert.equal(saved.includes("messagesById"), false)
  assert.equal(saved.includes("正文"), false)
  assert.equal(
    sanitizeWorkspaceState({
      version: 1,
      workspace: {
        view: "canvas",
        openThreadIds: [thread().id, 3],
        selectedThreadId: thread().id,
        recents: [],
        canvas: { pins: {} },
        panelSizes: {},
        expandedNodes: [],
        messagesById: { leaked: true },
      },
    }).view,
    "canvas"
  )
}

await testStoreAndSelectors()
await testAiSdkReducer()
await testOneShotSse()
await testTerminalPoller()
await testOptimisticRollbackIsolation()
await testRetryABC()
await testPartsProjectionAndWorkspaceIsolation()

console.log("normalized client/store tests passed")
