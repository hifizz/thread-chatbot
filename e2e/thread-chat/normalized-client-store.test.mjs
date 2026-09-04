import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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
import { followAcceptedGeneration } from "../../app/thread-chat/net/stream/generation-connection.ts"
import { bootConversationProject } from "../../app/thread-chat/net/boot/conversation-boot.ts"
import { hasCompletedAssistantActions } from "../../app/thread-chat/chat/actions/message-action-types.ts"

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
    files: [],
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
  assert.equal(tree.threads.main.id, "main")
  assert.equal(tree.threads[child.id].parentId, "main")
  assert.ok(tree.threads[child.id], "旧来源被 supersede 后子分支仍可投影")
  assert.equal(tree.threads.main.messages.length, 1)
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

async function testLateSnapshotAndDisconnectPolling() {
  const generating = message({
    status: "generating",
    error: null,
    finishedAt: null,
    parts: [],
  })
  const terminal = message({
    status: "completed",
    error: null,
    parts: [
      { type: "text", text: "迟到快照 + 后续 chunk + 轮询终态" },
      {
        type: "tool-createMarkdownArtifact",
        toolCallId: "tool-artifact",
        state: "output-available",
        input: { title: "断流报告", content: "# 断流报告" },
        output: {
          created: true,
          artifactId: "00000000-0000-4000-8000-000000000320",
        },
      },
    ],
  })
  const terminalArtifact = {
    id: "00000000-0000-4000-8000-000000000320",
    projectId: project().id,
    sourceMessageId: terminal.id,
    kind: "markdown",
    title: "断流报告",
    content: "# 断流报告",
    language: null,
    metadata: {},
    createdAt: stamp,
    updatedAt: stamp,
  }
  const store = createConversationStore({
    bootstrap: bootstrap({ messages: [generating] }),
  })
  let sseCalls = 0
  let polls = 0
  const liveTexts = []
  const unsubscribe = store.subscribe((state) => {
    const live = state.streamByMessageId[generating.id]?.liveMessage
    const text = live?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
    if (text) liveTexts.push(text)
  })
  const connection = followAcceptedGeneration({
    store,
    accepted: {
      project: project(),
      thread: thread(),
      assistantMessage: generating,
      streamUrl: "/late-stream",
    },
    client: {
      async getMessage() {
        polls += 1
        return terminal
      },
      async getArtifact(id) {
        assert.equal(id, terminalArtifact.id)
        return terminalArtifact
      },
    },
    pollDelays: [0],
    wait: async () => undefined,
    fetch: async () => {
      sseCalls += 1
      return sseResponse([
        {
          type: "snapshot",
          message: {
            id: generating.id,
            role: "assistant",
            parts: [{ type: "text", text: "迟到快照", state: "streaming" }],
          },
          throughSeq: 2,
          replay: [
            { seq: 1, chunk: { type: "text-start", id: "text-late" } },
            {
              seq: 2,
              chunk: {
                type: "text-delta",
                id: "text-late",
                delta: "迟到快照",
              },
            },
          ],
        },
        {
          type: "chunk",
          seq: 3,
          chunk: { type: "text-delta", id: "text-late", delta: " + 后续" },
        },
      ])
    },
  })
  await connection.finished
  unsubscribe()
  assert.equal(sseCalls, 1, "断流不得自动重连 SSE")
  assert.equal(polls, 1)
  assert.ok(
    liveTexts.includes("迟到快照"),
    "replay 应在未来 chunk 前直接入 Store"
  )
  assert.ok(
    liveTexts.includes("迟到快照 + 后续"),
    `应显示 snapshot 后续 chunk，实际 liveTexts=${JSON.stringify(liveTexts)}`
  )
  assert.equal(store.getState().messagesById[terminal.id].status, "completed")
  assert.equal(
    store.getState().streamByMessageId[terminal.id].phase,
    "terminal"
  )
  assert.equal(
    store.getState().artifactsById[terminalArtifact.id].title,
    "断流报告"
  )
}

async function testAcceptedGenerationStartsConnectingBeforeFirstSse() {
  const generating = message({
    status: "generating",
    error: null,
    finishedAt: null,
    parts: [],
  })
  const store = createConversationStore({
    bootstrap: bootstrap({ messages: [generating] }),
  })
  let releaseFetch
  const fetchStarted = new Promise((resolve) => {
    releaseFetch = resolve
  })
  const connection = followAcceptedGeneration({
    store,
    accepted: {
      project: project(),
      thread: thread(),
      assistantMessage: generating,
      streamUrl: "/waiting-stream",
    },
    client: {
      async getMessage() {
        return message({ status: "completed", error: null })
      },
      async getArtifact() {
        throw new Error("unexpected artifact fetch")
      },
    },
    fetch: async () => {
      await fetchStarted
      return sseResponse([
        {
          type: "terminal",
          message: message({ status: "completed", error: null }),
        },
      ])
    },
  })

  assert.equal(
    store.getState().streamByMessageId[generating.id].phase,
    "connecting"
  )
  assert.equal(
    projectMessageDTO({
      state: store.getState(),
      message: generating,
      parentMessageId: null,
    }).backgroundGeneration,
    false
  )
  releaseFetch()
  await connection.finished
}

async function testBootstrapBackgroundPollAndWorkspace() {
  const generating = message({
    status: "generating",
    error: null,
    finishedAt: null,
  })
  const terminal = message({ status: "completed", error: null })
  const store = createConversationStore()
  const key = `thread-chat:workspace:${project().id}`
  const saved = new Map([
    [
      key,
      JSON.stringify({
        version: 1,
        workspace: {
          view: "canvas",
          openThreadIds: [thread().id],
          selectedThreadId: thread().id,
          recents: [],
          canvas: { pins: {} },
          panelSizes: {},
          expandedNodes: [],
        },
      }),
    ],
  ])
  const storage = {
    getItem(name) {
      return saved.get(name) ?? null
    },
    setItem(name, value) {
      saved.set(name, value)
    },
  }
  const handle = await bootConversationProject({
    projectId: project().id,
    store,
    storage,
    client: {
      async getProject() {
        return bootstrap({
          messages: [generating],
          activeGenerationIds: [generating.id],
        })
      },
      async getMessage() {
        return terminal
      },
      async generateThreadTitle() {
        return {
          project: project({ autoTitle: "后台标题" }),
          thread: thread({
            autoTitle: "后台标题",
            titleGenerationAttempted: true,
            titleGenerated: true,
          }),
          title: "后台标题",
          generated: true,
        }
      },
    },
    pollDelays: [0],
    wait: async () => undefined,
  })
  assert.equal(store.getState().workspace.view, "canvas")
  assert.equal(
    store.getState().streamByMessageId[generating.id].phase,
    "background"
  )
  await handle.background[0].finished
  assert.equal(store.getState().messagesById[generating.id].status, "completed")
  store.getState().setWorkspace({ view: "columns" })
  assert.match(saved.get(key), /"view":"columns"/)
  assert.doesNotMatch(saved.get(key), /messagesById/)
  handle.dispose()
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
    async generateThreadTitle() {
      return {
        project: project({ autoTitle: "重试标题" }),
        thread: thread({
          autoTitle: "重试标题",
          titleGenerationAttempted: true,
          titleGenerated: true,
        }),
        title: "重试标题",
        generated: true,
      }
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

async function testCommandFilesPassThrough() {
  const store = createConversationStore({ bootstrap: bootstrap({ messages: [] }) })
  const file = {
    url: `/api/attachments/${crypto.randomUUID()}`,
    mediaType: "text/plain",
    filename: "pasted.txt",
  }
  let seen
  const assistant = message({
    id: crypto.randomUUID(),
    sequence: 2,
    status: "generating",
    error: null,
    finishedAt: null,
    parts: [],
  })
  const commands = createConversationCommands({
    store,
    networkAttempts: 1,
    createId: () => crypto.randomUUID(),
    client: {
      async sendMessage(_threadId, command) {
        seen = command
        return {
          ok: true,
          replayed: false,
          data: {
            project: project(),
            thread: thread(),
            userMessage: message({ role: "user", parts: [] }),
            assistantMessage: assistant,
            streamUrl: "/files",
          },
        }
      },
      async getMessage() {
        return { ...assistant, status: "completed", finishedAt: stamp }
      },
      async generateThreadTitle() {
        return {
          project: project(),
          thread: thread(),
          title: "测试项目",
          generated: false,
        }
      },
    },
    fetch: async () =>
      sseResponse([
        {
          type: "terminal",
          message: { ...assistant, status: "completed", finishedAt: stamp },
        },
      ]),
  })
  const result = await commands.sendMessage({
    threadId: thread().id,
    modelId: "test/model",
    text: "读取附件",
    files: [file],
  })
  assert.deepEqual(seen.files, [file])
  assert.deepEqual(
    store.getState().messagesById[result.command.userMessageId].parts,
    [{ type: "text", text: "读取附件" }, { type: "file", ...file }]
  )
  await result.connection.finished
  commands.dispose()
}

async function testCommandNetworkRetryReusesFrozenPayload() {
  const store = createConversationStore({
    bootstrap: bootstrap({ messages: [] }),
  })
  const seen = []
  const assistant = message({
    id: "00000000-0000-4000-8000-000000000302",
    sequence: 2,
    status: "generating",
    error: null,
    finishedAt: null,
    parts: [],
  })
  const user = message({
    id: "00000000-0000-4000-8000-000000000301",
    sequence: 1,
    role: "user",
    status: "completed",
    error: null,
    parts: [{ type: "text", text: "同一负载" }],
  })
  const commands = createConversationCommands({
    store,
    networkAttempts: 2,
    createId: (() => {
      const ids = [
        "00000000-0000-4000-8000-000000000310",
        user.id,
        assistant.id,
      ]
      return () => ids.shift()
    })(),
    client: {
      async sendMessage(_threadId, command) {
        seen.push(command)
        if (seen.length === 1) throw new Error("temporary network failure")
        return {
          ok: true,
          replayed: false,
          data: {
            project: project(),
            thread: thread(),
            userMessage: user,
            assistantMessage: assistant,
            streamUrl: "/retry-once",
          },
        }
      },
      async getMessage(id) {
        return message({ id, status: "completed", error: null })
      },
      async generateThreadTitle() {
        return {
          project: project({ autoTitle: "网络重试标题" }),
          thread: thread({
            autoTitle: "网络重试标题",
            titleGenerationAttempted: true,
            titleGenerated: true,
          }),
          title: "网络重试标题",
          generated: true,
        }
      },
    },
    fetch: async () =>
      sseResponse([
        {
          type: "terminal",
          message: message({
            id: assistant.id,
            status: "completed",
            error: null,
          }),
        },
      ]),
  })
  const result = await commands.sendMessage({
    threadId: thread().id,
    modelId: "test/model",
    text: "同一负载",
  })
  await result.connection.finished
  assert.equal(seen.length, 2)
  assert.equal(seen[0], seen[1], "网络重试必须复用同一个冻结 command 对象")
  assert.equal(Object.isFrozen(seen[0]), true)
  commands.dispose()
}

async function testCommandTitleGenerationUpdatesStore() {
  const ids = [
    "00000000-0000-4000-8000-000000000901",
    "00000000-0000-4000-8000-000000000902",
    "00000000-0000-4000-8000-000000000903",
    "00000000-0000-4000-8000-000000000904",
    "00000000-0000-4000-8000-000000000905",
    "00000000-0000-4000-8000-000000000906",
    "00000000-0000-4000-8000-000000000907",
    "00000000-0000-4000-8000-000000000908",
  ]
  const store = createConversationStore()
  const titleCalls = []
  const terminalThreadByMessageId = new Map()
  const commands = createConversationCommands({
    store,
    networkAttempts: 1,
    createId: () => ids.shift(),
    client: {
      async startProject(_projectId, command) {
        terminalThreadByMessageId.set(
          command.assistantMessageId,
          command.rootThreadId
        )
        return {
          ok: true,
          replayed: false,
          data: {
            project: project({
              id: command.projectId,
              rootThreadId: command.rootThreadId,
              autoTitle: null,
            }),
            thread: thread({
              id: command.rootThreadId,
              projectId: command.projectId,
              autoTitle: null,
              titleGenerationAttempted: false,
              titleGenerated: false,
            }),
            userMessage: message({
              id: command.userMessageId,
              projectId: command.projectId,
              threadId: command.rootThreadId,
              sequence: 1,
              role: "user",
              status: "completed",
              error: null,
              parts: [{ type: "text", text: command.text }],
            }),
            assistantMessage: message({
              id: command.assistantMessageId,
              projectId: command.projectId,
              threadId: command.rootThreadId,
              sequence: 2,
              status: "generating",
              error: null,
              finishedAt: null,
              parts: [],
            }),
            streamUrl: `/title-start/${command.assistantMessageId}`,
          },
        }
      },
      async forkThread(parentThreadId, command) {
        const child = thread({
          id: command.threadId,
          parentId: parentThreadId,
          forkMessageId: command.sourceMessageId,
          anchorText: command.anchorText,
          footnote: 1,
          depth: 1,
          autoTitle: null,
          titleGenerationAttempted: false,
          titleGenerated: false,
        })
        terminalThreadByMessageId.set(
          command.firstTurn.assistantMessageId,
          child.id
        )
        return {
          ok: true,
          replayed: false,
          data: {
            thread: child,
            generation: {
              project: store.getState().project,
              thread: child,
              userMessage: message({
                id: command.firstTurn.userMessageId,
                threadId: child.id,
                sequence: 1,
                role: "user",
                status: "completed",
                error: null,
                parts: [{ type: "text", text: command.firstTurn.text }],
              }),
              assistantMessage: message({
                id: command.firstTurn.assistantMessageId,
                threadId: child.id,
                sequence: 2,
                status: "generating",
                error: null,
                finishedAt: null,
                parts: [],
              }),
              streamUrl: `/title-branch/${command.firstTurn.assistantMessageId}`,
            },
          },
        }
      },
      async getMessage(id) {
        return message({ id, status: "completed", error: null })
      },
      async getArtifact() {
        throw new Error("unexpected artifact fetch")
      },
      async generateThreadTitle(threadId) {
        titleCalls.push(threadId)
        const current = store.getState()
        const target = current.threadsById[threadId]
        const autoTitle =
          target.parentId === null ? "主线自动标题" : "分支自动标题"
        return {
          project: {
            ...current.project,
            ...(target.parentId === null ? { autoTitle } : {}),
          },
          thread: {
            ...target,
            autoTitle,
            titleGenerationAttempted: true,
            titleGenerated: true,
          },
          title: autoTitle,
          generated: true,
        }
      },
    },
    fetch: async (url) => {
      const messageId = String(url).split("/").at(-1)
      return sseResponse([
        {
          type: "terminal",
          message: message({
            id: messageId,
            threadId: terminalThreadByMessageId.get(messageId),
            status: "completed",
            error: null,
          }),
        },
      ])
    },
  })

  const started = await commands.startProject({
    projectId: project().id,
    modelId: "test/model",
    text: "研究主线标题",
  })
  await Promise.resolve()
  await started.connection.finished
  assert.equal(store.getState().project.autoTitle, "主线自动标题")
  assert.equal(
    store.getState().threadsById[started.command.rootThreadId].autoTitle,
    "主线自动标题"
  )

  const forked = await commands.forkThread({
    parentThreadId: started.command.rootThreadId,
    sourceMessageId: started.command.assistantMessageId,
    anchorText: "锚点",
    anchor: { quote: { exact: "锚点", prefix: "", suffix: "" } },
    modelId: "test/model",
    text: "解释锚点",
  })
  await forked.connection.finished
  assert.equal(
    store.getState().threadsById[forked.command.threadId].autoTitle,
    "分支自动标题"
  )
  assert.deepEqual(titleCalls, [
    started.command.rootThreadId,
    forked.command.threadId,
  ])
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

async function testStoppedProjectionPreservesExistingPresentation() {
  const emptyStopped = message({
    status: "stopped",
    error: null,
    parts: [],
  })
  const emptyStore = createConversationStore({
    bootstrap: bootstrap({ messages: [emptyStopped] }),
  })
  const emptyProjected = projectMessageDTO({
    state: emptyStore.getState(),
    message: emptyStopped,
    parentMessageId: null,
  })
  assert.equal(emptyProjected.status, "stopped")
  assert.equal(emptyProjected.error, undefined)
  assert.equal(hasCompletedAssistantActions(emptyProjected), false)

  const partialStopped = message({
    status: "stopped",
    error: null,
    parts: [{ type: "text", text: "已经生成的部分内容" }],
  })
  const partialStore = createConversationStore({
    bootstrap: bootstrap({ messages: [partialStopped] }),
  })
  const partialProjected = projectMessageDTO({
    state: partialStore.getState(),
    message: partialStopped,
    parentMessageId: null,
  })
  assert.equal(partialProjected.status, "stopped")
  assert.equal(partialProjected.error, undefined)
  assert.equal(partialProjected.text, "已经生成的部分内容")
  assert.deepEqual(partialProjected.uiParts, partialStopped.parts)
  assert.equal(hasCompletedAssistantActions(partialProjected), false)
}

async function testGate3HarnessIsolation() {
  const root = new URL("../../", import.meta.url)
  const [page, harness, mockRuntime, proxy, productionPage] = await Promise.all(
    [
      readFile(
        new URL("app/thread-chat-gate-3-harness/[projectId]/page.tsx", root),
        "utf8"
      ),
      readFile(
        new URL("app/thread-chat/gate-3-harness/normalized-harness.tsx", root),
        "utf8"
      ),
      readFile(
        new URL("app/thread-chat/gate-3-harness/mock-v1-runtime.ts", root),
        "utf8"
      ),
      readFile(new URL("proxy.ts", root), "utf8"),
      readFile(new URL("app/thread-chat/[treeId]/page.tsx", root), "utf8"),
    ]
  )

  assert.match(page, /process\.env\.NODE_ENV !== "development"/)
  assert.match(page, /notFound\(\)/)
  assert.match(
    proxy,
    /pathname\.startsWith\("\/thread-chat-gate-3-harness\/"\)/
  )
  assert.match(proxy, /\["localhost", "127\.0\.0\.1"\]/)
  for (const component of [
    "ThreadColumns",
    "ThreadCanvas",
    "BranchableChat",
    "ArtifactDrawer",
    "createConversationCommands",
  ])
    assert.match(harness, new RegExp(component))
  assert.doesNotMatch(
    `${page}\n${harness}\n${mockRuntime}`,
    /\/api\/(?:chat|branch-trees)/
  )
  assert.doesNotMatch(productionPage, /gate-3-harness/i)
}

await testStoreAndSelectors()
await testAiSdkReducer()
await testOneShotSse()
await testTerminalPoller()
await testLateSnapshotAndDisconnectPolling()
await testAcceptedGenerationStartsConnectingBeforeFirstSse()
await testBootstrapBackgroundPollAndWorkspace()
await testOptimisticRollbackIsolation()
await testRetryABC()
await testCommandFilesPassThrough()
await testCommandNetworkRetryReusesFrozenPayload()
await testCommandTitleGenerationUpdatesStore()
await testPartsProjectionAndWorkspaceIsolation()
await testStoppedProjectionPreservesExistingPresentation()
await testGate3HarnessIsolation()

console.log("normalized client/store tests passed")
