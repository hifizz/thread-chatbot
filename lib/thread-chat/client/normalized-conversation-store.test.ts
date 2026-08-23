import assert from "node:assert/strict"
import test from "node:test"

import type { CommandSuccess } from "../application/conversation-command-contracts.ts"
import type { CanonicalGenerationRecord } from "../application/conversation-generation-service.ts"
import { emptyConversationGenerationCheckpoint } from "../domain/conversation-generation.ts"
import {
  artifactId,
  conversationId,
  generationId,
  messageId,
  projectId,
  threadForkId,
  threadId,
  turnId,
  workspaceId,
  type ConversationMessage,
  type ConversationSnapshot,
} from "../domain/conversation-model.ts"
import {
  clearConversationDerivedCache,
  deriveConversationClientIndexes,
  selectThreadMessages,
} from "./conversation-client-selectors.ts"
import { createNormalizedConversationStore } from "./normalized-conversation-store.ts"
import {
  createConversationUiWorkspaceStore,
  defaultConversationUiWorkspace,
  parseConversationUiWorkspace,
  serializeConversationUiWorkspace,
} from "./ui-workspace.ts"
import {
  ConversationClientError,
  createConversationClientGateway,
} from "./conversation-client-gateway.ts"
import {
  createGenerationCoordinator,
  type GenerationCoordinatorScheduler,
} from "./generation-coordinator.ts"

const workspace = workspaceId("workspace-client-test")
const project = projectId("project-client-test")
const conversation = conversationId("conversation-client-test")
const root = threadId("thread-root")
const threadA = threadId("thread-A")
const threadB = threadId("thread-B")
const threadC = threadId("thread-C")

function content(text: string) {
  return {
    schemaVersion: 1 as const,
    parts: [{ type: "text" as const, text }],
  }
}

function message(input: {
  id: string
  threadId: ReturnType<typeof threadId>
  turnId: ReturnType<typeof turnId>
  role: "user" | "assistant"
  text: string
}): ConversationMessage {
  return {
    id: messageId(input.id),
    threadId: input.threadId,
    turnId: input.turnId,
    role: input.role,
    content: content(input.text),
    contentState: "complete",
    createdAt: `2026-08-22T00:00:0${input.id.length % 9}.000Z`,
  }
}

function fixture() {
  const threadIds = [root, threadA, threadB, threadC]
  const turns = Object.fromEntries(
    threadIds.map((targetThreadId, index) => {
      const id = turnId(`turn-${index}`)
      return [
        id,
        {
          id,
          threadId: targetThreadId,
          position: 0,
          activeUserMessageId: messageId(`message-${index}-user`),
          activeAssistantMessageId: messageId(`message-${index}-assistant`),
          revision: 0,
        },
      ]
    })
  )
  const messages = Object.fromEntries(
    threadIds.flatMap((targetThreadId, index) => {
      const targetTurnId = turnId(`turn-${index}`)
      const user = message({
        id: `message-${index}-user`,
        threadId: targetThreadId,
        turnId: targetTurnId,
        role: "user",
        text: `用户-${index}`,
      })
      const assistant = message({
        id: `message-${index}-assistant`,
        threadId: targetThreadId,
        turnId: targetTurnId,
        role: "assistant",
        text: `助手-${index}`,
      })
      return [
        [user.id, user],
        [assistant.id, assistant],
      ]
    })
  )
  const snapshot: ConversationSnapshot = {
    schemaVersion: 1,
    project: {
      id: project,
      workspaceId: workspace,
      title: "客户端测试",
      revision: 0,
      lifecycle: "active",
    },
    conversation: {
      id: conversation,
      projectId: project,
      rootThreadId: root,
      autoTitle: "规范客户端",
      customTitle: null,
      revision: 0,
      lifecycle: "active",
    },
    threads: Object.fromEntries(
      threadIds.map((id, index) => [
        id,
        {
          id,
          conversationId: conversation,
          modelId: "glm-5.3",
          localTitle: index === 0 ? null : `分支-${index}`,
          revision: 0,
          lifecycle: "active" as const,
        },
      ])
    ),
    threadForks: {
      "fork-A": {
        id: threadForkId("fork-A"),
        conversationId: conversation,
        parentThreadId: root,
        childThreadId: threadA,
        sourceMessageId: messageId("message-0-assistant"),
        createdBy: "user-client-test",
        createdAt: "2026-08-22T00:00:10.000Z",
      },
      "fork-B": {
        id: threadForkId("fork-B"),
        conversationId: conversation,
        parentThreadId: threadA,
        childThreadId: threadB,
        sourceMessageId: messageId("message-1-assistant"),
        createdBy: "user-client-test",
        createdAt: "2026-08-22T00:00:11.000Z",
      },
      "fork-C": {
        id: threadForkId("fork-C"),
        conversationId: conversation,
        parentThreadId: threadB,
        childThreadId: threadC,
        sourceMessageId: messageId("message-2-assistant"),
        createdBy: "user-client-test",
        createdAt: "2026-08-22T00:00:12.000Z",
      },
    },
    turns,
    messages,
    generations: {},
    artifactProvenance: {
      "artifact-client-test": {
        id: artifactId("artifact-client-test"),
        sourceThreadId: threadA,
        sourceMessageId: messageId("message-1-assistant"),
        title: "规范 Artifact",
        kind: "markdown",
        lang: "markdown",
        content: "# 规范 Artifact\n\n规范内容",
      },
    },
  }
  return {
    snapshot,
    generations: [],
    contextMessageIdsByThread: {},
  }
}

function generationRecord(input: {
  id: string
  threadId: ReturnType<typeof threadId>
  turnId: ReturnType<typeof turnId>
  inputMessageId: string
  outputMessageId: string
  checkpointVersion: number
  body: string
}): CanonicalGenerationRecord {
  const id = generationId(input.id)
  return {
    id,
    ownerId: "user-client-test",
    workspaceId: workspace,
    projectId: project,
    conversationId: conversation,
    threadId: input.threadId,
    turnId: input.turnId,
    inputMessageId: messageId(input.inputMessageId),
    outputMessageId: messageId(input.outputMessageId),
    intent: { kind: "send" },
    requestHash: "hash",
    idempotencyKey: "key",
    modelId: "glm-5.3",
    attempt: 1,
    isCurrent: true,
    status: "running",
    billingStatus: "pending",
    contentState: "streaming",
    checkpointVersion: input.checkpointVersion,
    checkpoint: {
      ...emptyConversationGenerationCheckpoint(),
      body: input.body,
      contentState: "streaming",
    },
    knownUsage: null,
    usageCompleteness: "unavailable",
    paidCallStarted: true,
    leaseOwner: "worker",
    leaseVersion: 0,
    heartbeatAt: "2026-08-22T00:00:20.000Z",
    stopRequestedAt: null,
    startedAt: "2026-08-22T00:00:20.000Z",
    finishedAt: null,
    errorCode: null,
    createdAt: "2026-08-22T00:00:20.000Z",
  }
}

test("快照先完整验证再原子安装，失败不覆盖旧状态", () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  const before = store.getState()
  assert.equal(before.commitVersion, 1)
  assert.ok(Object.isFrozen(before.messagesById["message-0-user"]))

  const baseInvalid = fixture()
  const invalid = {
    ...baseInvalid,
    snapshot: {
      ...baseInvalid.snapshot,
      threadForks: {
        ...baseInvalid.snapshot.threadForks,
        "fork-A": {
          ...baseInvalid.snapshot.threadForks["fork-A"]!,
          sourceMessageId: messageId("missing"),
        },
      },
    },
  }
  assert.throws(() => store.installSnapshot(invalid))
  assert.equal(store.getState(), before)
  assert.equal(store.getState().commitVersion, 1)
})

test("A → B → C 索引、继承上下文和画布边可从规范实体重建", () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  const first = deriveConversationClientIndexes(store.getState())
  assert.equal(first.depthByThread[threadC], 3)
  assert.deepEqual(first.contextMessageIdsByThread[threadC], [
    messageId("message-0-user"),
    messageId("message-0-assistant"),
    messageId("message-1-user"),
    messageId("message-1-assistant"),
    messageId("message-2-user"),
    messageId("message-2-assistant"),
    messageId("message-3-user"),
    messageId("message-3-assistant"),
  ])
  assert.equal(first.canvasEdges.length, 3)
  clearConversationDerivedCache()
  const rebuilt = deriveConversationClientIndexes(store.getState())
  assert.deepEqual(rebuilt, first)
  assert.equal(selectThreadMessages(store.getState(), threadC, true).length, 8)
})

test("Message 结构化研究与 Artifact 来源通过稳定 Message/Thread ID 保留", () => {
  const value = fixture()
  const source = value.snapshot.messages[messageId("message-1-assistant")]!
  value.snapshot = {
    ...value.snapshot,
    messages: {
      ...value.snapshot.messages,
      [source.id]: {
        ...source,
        content: {
          schemaVersion: 1,
          parts: [
            { type: "text", text: "## Markdown 结果" },
            {
              type: "structured",
              kind: "research-activities",
              value: [
                {
                  id: "research-1",
                  kind: "web-search",
                  status: "complete",
                  sources: [{ url: "https://example.invalid/source" }],
                },
              ],
            },
            {
              type: "artifact-reference",
              artifactId: artifactId("artifact-client-test"),
            },
          ],
        },
      },
    },
  }
  const store = createNormalizedConversationStore()
  store.installSnapshot(value)
  const selected = selectThreadMessages(store.getState(), threadA).find(
    (candidate) => candidate.id === source.id
  )
  assert.ok(selected)
  assert.equal(selected.threadId, threadA)
  assert.equal(selected.content.parts[1]?.type, "structured")
  assert.equal(
    store.getState().artifactProvenanceById["artifact-client-test"]
      ?.sourceMessageId,
    source.id
  )
})

test("父 Turn 切换变体后，历史 Fork 仍精确继承原 source Message", () => {
  const base = fixture()
  const sourceTurn = base.snapshot.turns[turnId("turn-0")]!
  const oldSource = base.snapshot.messages[messageId("message-0-assistant")]!
  const nextSource = message({
    id: "message-0-assistant-v2",
    threadId: root,
    turnId: sourceTurn.id,
    role: "assistant",
    text: "新的 active 变体",
  })
  const oldGenerationId = generationId("generation-old-fork-source")
  const value = {
    ...base,
    snapshot: {
      ...base.snapshot,
      turns: {
        ...base.snapshot.turns,
        [sourceTurn.id]: {
          ...sourceTurn,
          activeAssistantMessageId: nextSource.id,
          revision: 1,
        },
      },
      messages: {
        ...base.snapshot.messages,
        [nextSource.id]: { ...nextSource, variantOfMessageId: oldSource.id },
      },
      generations: {
        [oldGenerationId]: {
          id: oldGenerationId,
          threadId: root,
          turnId: sourceTurn.id,
          inputMessageId: sourceTurn.activeUserMessageId,
          outputMessageId: oldSource.id,
          intent: { kind: "send" as const },
          status: "completed" as const,
          billingStatus: "not_billable" as const,
          attempt: 1,
          createdAt: oldSource.createdAt,
        },
      },
    },
  }
  const store = createNormalizedConversationStore()
  store.installSnapshot(value)
  const inherited = deriveConversationClientIndexes(store.getState())
    .contextMessageIdsByThread[threadA]
  assert.ok(inherited?.includes(oldSource.id))
  assert.ok(!inherited?.includes(nextSource.id))
})

test("delta 幂等忽略旧值，版本间隙和未知 schema 标记重取", () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  const rename: CommandSuccess = {
    schemaVersion: 1,
    data: {},
    revisions: { [conversation]: 1 },
    delta: {
      upsert: {
        conversations: [
          {
            ...fixture().snapshot.conversation,
            customTitle: "新标题",
            revision: 1,
          },
        ],
      },
      remove: {},
      invalidate: [],
    },
    replayed: false,
  }
  assert.equal(store.mergeCommandResult(rename).applied, true)
  const version = store.getState().commitVersion
  assert.equal(store.mergeCommandResult(rename).applied, false)
  assert.equal(store.getState().commitVersion, version)

  const old = {
    ...rename,
    delta: {
      ...rename.delta,
      upsert: {
        conversations: [
          { ...fixture().snapshot.conversation, customTitle: "旧标题" },
        ],
      },
    },
  } satisfies CommandSuccess
  assert.equal(store.mergeCommandResult(old).applied, false)
  assert.equal(
    store.getState().conversationsById[conversation]?.customTitle,
    "新标题"
  )

  const gap = {
    ...rename,
    revisions: { [conversation]: 3 },
  } satisfies CommandSuccess
  assert.equal(store.mergeCommandResult(gap).requiresReload, true)
  assert.ok(store.getState().staleConversationIds.has(conversation))

  const unknown = { ...rename, schemaVersion: 2 } as unknown as CommandSuccess
  assert.equal(store.mergeCommandResult(unknown).requiresReload, true)
})

test("Generation 只接受更高 checkpoint，并且不通知无关 Thread", () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  let rootNotifications = 0
  let branchNotifications = 0
  store.subscribe(`thread:${root}:messages`, () => {
    rootNotifications += 1
  })
  store.subscribe(`thread:${threadA}:messages`, () => {
    branchNotifications += 1
  })
  const first = generationRecord({
    id: "generation-A",
    threadId: threadA,
    turnId: turnId("turn-1"),
    inputMessageId: "message-1-user",
    outputMessageId: "message-1-assistant",
    checkpointVersion: 2,
    body: "新的正文",
  })
  assert.equal(store.mergeGeneration(first).applied, true)
  assert.equal(
    store.mergeGeneration({ ...first, checkpointVersion: 1 }).applied,
    false
  )
  assert.equal(rootNotifications, 0)
  assert.equal(branchNotifications, 1)
  assert.deepEqual(
    store.getState().messagesById["message-1-assistant"]?.content,
    content("新的正文")
  )
})

test("UI Workspace 持久化只恢复当前 Conversation 的活跃 Thread", () => {
  const loaded = fixture().snapshot
  const seed = defaultConversationUiWorkspace({
    conversationId: conversation,
    rootThreadId: root,
  })
  const workspaceStore = createConversationUiWorkspaceStore(seed)
  workspaceStore.openThread(threadA)
  workspaceStore.foldThread(threadA, true)
  workspaceStore.setDraft(threadA, "保留草稿")
  const raw = serializeConversationUiWorkspace(workspaceStore.getState())
  const threads = {
    ...loaded.threads,
    [threadA]: { ...loaded.threads[threadA]!, lifecycle: "archived" as const },
  }
  const restored = parseConversationUiWorkspace({
    raw,
    conversationId: conversation,
    rootThreadId: root,
    threads,
  })
  assert.deepEqual(restored.visibleThreadIds, [root])
  assert.equal(restored.selectedThreadId, root)
  assert.equal(restored.draftsByThreadId[threadA], undefined)
})

test("UI Workspace 操作不改变 canonical revision 或触发 canonical 通知", () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  const revisionBefore = store.revisionOf(conversation)
  const commitBefore = store.getState().commitVersion
  let canonicalNotifications = 0
  const unsubscribe = store.subscribe("canonical", () => {
    canonicalNotifications += 1
  })
  const workspaceStore = createConversationUiWorkspaceStore(
    defaultConversationUiWorkspace({
      conversationId: conversation,
      rootThreadId: root,
    })
  )
  workspaceStore.openThread(threadA)
  workspaceStore.foldThread(threadA, true)
  workspaceStore.update((current) => ({
    ...current,
    viewMode: "canvas",
    openPanels: ["artifact"],
  }))
  unsubscribe()
  assert.equal(store.revisionOf(conversation), revisionBefore)
  assert.equal(store.getState().commitVersion, commitBefore)
  assert.equal(canonicalNotifications, 0)
})

function commandResult(title: string): CommandSuccess {
  return {
    schemaVersion: 1,
    data: {},
    revisions: { [conversation]: 1 },
    delta: {
      upsert: {
        conversations: [
          {
            ...fixture().snapshot.conversation,
            customTitle: title,
            revision: 1,
          },
        ],
      },
      remove: {},
      invalidate: [],
    },
    replayed: false,
  }
}

test("client gateway 使用最小 revision，并以同一幂等键确认网络不确定命令", async () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  const requests: RequestInit[] = []
  let attempt = 0
  const gateway = createConversationClientGateway({
    store,
    fetch: async (_url, init) => {
      requests.push(init ?? {})
      attempt += 1
      if (attempt === 1) throw new Error("connection reset")
      return Response.json(commandResult("幂等确认成功"))
    },
  })
  const commandId = "command-network-retry"
  await assert.rejects(
    gateway.renameConversation(
      conversation,
      { title: "幂等确认成功" },
      {
        commandId,
        overlay: { kind: "rename", presentationKey: "title" },
      }
    ),
    (error) =>
      error instanceof ConversationClientError &&
      error.code === "network_uncertain" &&
      error.uncertain
  )
  assert.equal(
    store.getCommandState().pendingByCommandId[commandId]?.status,
    "confirming"
  )
  await gateway.retry(commandId)
  const firstHeaders = new Headers(requests[0]?.headers)
  const retryHeaders = new Headers(requests[1]?.headers)
  assert.equal(firstHeaders.get("Idempotency-Key"), commandId)
  assert.equal(retryHeaders.get("Idempotency-Key"), commandId)
  assert.equal(firstHeaders.get("X-Command-Id"), commandId)
  assert.equal(firstHeaders.get("If-Match"), '"0"')
  assert.equal(
    store.getState().conversationsById[conversation]?.customTitle,
    "幂等确认成功"
  )
  assert.equal(store.getCommandState().pendingByCommandId[commandId], undefined)
})

test("client gateway 在加载实体前校验 authority、schema 与 cutover epoch", async () => {
  const store = createNormalizedConversationStore()
  const responses = [
    Response.json({
      authority: "canonical",
      schemaVersion: 1,
      epoch: "epoch-a",
      maintenanceMode: "off",
    }),
    Response.json({
      authority: "canonical",
      schemaVersion: 1,
      epoch: "epoch-b",
      maintenanceMode: "off",
    }),
  ]
  const gateway = createConversationClientGateway({
    store,
    fetch: async () => responses.shift() ?? Response.error(),
  })

  await gateway.verifyAuthority({
    authority: "canonical",
    schemaVersion: 1,
    epoch: "epoch-a",
  })
  await assert.rejects(
    gateway.verifyAuthority({
      authority: "canonical",
      schemaVersion: 1,
      epoch: "epoch-a",
    }),
    (error) =>
      error instanceof ConversationClientError &&
      error.code === "authority_mismatch" &&
      error.details?.actual !== undefined
  )
})

test("client gateway 遇到 409 后重取快照并保留失败 overlay", async () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  let requestCount = 0
  const currentServerSnapshot = fixture()
  const serverSnapshot = {
    ...currentServerSnapshot,
    snapshot: {
      ...currentServerSnapshot.snapshot,
      conversation: {
        ...currentServerSnapshot.snapshot.conversation,
        customTitle: "服务端较新标题",
        revision: 1,
      },
    },
  }
  const gateway = createConversationClientGateway({
    store,
    fetch: async () => {
      requestCount += 1
      if (requestCount === 1)
        return Response.json(
          {
            error: {
              code: "version_conflict",
              message: "revision 已变化",
              requestId: "request-conflict",
              details: { currentRevision: 1 },
            },
          },
          { status: 409 }
        )
      return Response.json({ schemaVersion: 1, data: serverSnapshot })
    },
  })
  await assert.rejects(
    gateway.renameConversation(
      conversation,
      { title: "过期写入" },
      {
        commandId: "command-conflict",
        overlay: { kind: "rename", presentationKey: "title" },
      }
    ),
    (error) =>
      error instanceof ConversationClientError &&
      error.code === "version_conflict"
  )
  assert.equal(requestCount, 2)
  assert.equal(store.revisionOf(conversation), 1)
  assert.equal(
    store.getState().conversationsById[conversation]?.customTitle,
    "服务端较新标题"
  )
  assert.equal(
    store.getCommandState().pendingByCommandId["command-conflict"]?.status,
    "failed"
  )
})

test("共享 gateway 在发起视图卸载后仍合并已提交结果", async () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  let release!: (response: Response) => void
  const response = new Promise<Response>((resolve) => {
    release = resolve
  })
  const gateway = createConversationClientGateway({
    store,
    fetch: async () => response,
  })
  const submitted = gateway.renameConversation(
    conversation,
    { title: "卸载后仍完成" },
    { commandId: "command-unmounted" }
  )
  // 不保留任何组件订阅，也不把 AbortSignal 绑定到组件生命周期。
  release(Response.json(commandResult("卸载后仍完成")))
  await submitted
  assert.equal(
    store.getState().conversationsById[conversation]?.customTitle,
    "卸载后仍完成"
  )
})

test("Fork 使用 Conversation revision，消息反馈始终使用稳定实体 ID", async () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const gateway = createConversationClientGateway({
    store,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      if (String(url).endsWith("/message-feedback"))
        return Response.json({
          feedback: [
            {
              conversationId: conversation,
              threadId: root,
              messageId: "message-0-assistant",
              feedback: "positive",
              updatedAt: "2026-08-22T00:00:00.000Z",
            },
          ],
        })
      if (String(url).endsWith("/feedback"))
        return Response.json({
          feedback: {
            conversationId: conversation,
            threadId: root,
            messageId: "message-0-assistant",
            feedback: "negative",
            updatedAt: "2026-08-22T00:00:01.000Z",
          },
        })
      return Response.json(commandResult("Fork revision 已验证"))
    },
  })

  await gateway.forkThread(root, {
    conversationId: conversation,
    forkId: threadForkId("fork-gateway-test"),
    childThreadId: threadId("thread-gateway-child"),
    sourceMessageId: messageId("message-0-assistant"),
    modelId: "glm-5.3",
  })
  assert.equal(new Headers(requests[0]?.init?.headers).get("If-Match"), '"0"')

  const listed = await gateway.listMessageFeedback(conversation)
  assert.equal(listed[0]?.messageId, "message-0-assistant")
  const saved = await gateway.setMessageFeedback({
    conversationId: conversation,
    threadId: root,
    messageId: "message-0-assistant",
    feedback: "negative",
  })
  assert.equal(saved?.feedback, "negative")
  assert.equal(
    requests[2]?.url,
    `/api/conversations/${conversation}/messages/message-0-assistant/feedback`
  )
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
    threadId: root,
    feedback: "negative",
  })
})

class ManualScheduler implements GenerationCoordinatorScheduler {
  readonly timers = new Map<number, { callback: () => void; delayMs: number }>()
  private nextId = 1

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { callback, delayMs })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  runNext(): void {
    const [id, timer] = this.timers.entries().next().value ?? []
    if (id === undefined || !timer) return
    this.timers.delete(id)
    timer.callback()
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

test("GenerationCoordinator 多视图共享监控，释放不 Stop，重挂载恢复", async () => {
  const store = createNormalizedConversationStore()
  store.installSnapshot(fixture())
  const scheduler = new ManualScheduler()
  const records = [
    generationRecord({
      id: "generation-coordinator",
      threadId: threadA,
      turnId: turnId("turn-1"),
      inputMessageId: "message-1-user",
      outputMessageId: "message-1-assistant",
      checkpointVersion: 2,
      body: "checkpoint-2",
    }),
    generationRecord({
      id: "generation-coordinator",
      threadId: threadA,
      turnId: turnId("turn-1"),
      inputMessageId: "message-1-user",
      outputMessageId: "message-1-assistant",
      checkpointVersion: 1,
      body: "过期 checkpoint",
    }),
  ]
  let queries = 0
  const stops = 0
  const coordinator = createGenerationCoordinator({
    store,
    scheduler,
    visiblePollMs: 2_000,
    hiddenPollMs: 10_000,
    gateway: {
      getGeneration: async () =>
        records[Math.min(queries++, records.length - 1)]!,
    },
  })
  const targetGenerationId = generationId("generation-coordinator")
  const releaseColumn = coordinator.subscribe(targetGenerationId, () => {})
  const releasePanel = coordinator.subscribe(targetGenerationId, () => {})
  await flushPromises()
  assert.equal(queries, 1)
  assert.equal(coordinator.monitoredCount(), 1)
  assert.deepEqual(
    [...scheduler.timers.values()].map((timer) => timer.delayMs),
    [2_000]
  )

  coordinator.setVisibility("hidden")
  assert.deepEqual(
    [...scheduler.timers.values()].map((timer) => timer.delayMs),
    [10_000]
  )
  scheduler.runNext()
  await flushPromises()
  assert.equal(queries, 2)
  assert.equal(
    store.getState().checkpointVersionsByGenerationId[targetGenerationId],
    2
  )
  const checkpointPart =
    store.getState().messagesById["message-1-assistant"]?.content.parts[0]
  assert.equal(
    checkpointPart?.type === "text" ? checkpointPart.text : null,
    "checkpoint-2"
  )

  releaseColumn()
  assert.equal(coordinator.monitoredCount(), 1)
  releasePanel()
  assert.equal(coordinator.monitoredCount(), 0)
  assert.equal(scheduler.timers.size, 0)
  assert.equal(stops, 0)

  const releaseRemount = coordinator.subscribe(targetGenerationId, () => {})
  await flushPromises()
  assert.equal(queries, 3)
  releaseRemount()
  coordinator.dispose()
})
