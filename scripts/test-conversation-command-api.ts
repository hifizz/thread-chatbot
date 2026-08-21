import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { config } from "dotenv"

config({ path: ".env.local" })
process.env.CONVERSATION_COMMAND_API_AUTHORITY = "isolated-test"

const { count, eq } = await import("drizzle-orm")
const { db } = await import("../lib/db/index.ts")
const {
  conversationCommandRecords,
  conversationGenerations,
  conversationOutboxEvents,
  conversationThreads,
  user,
  workspaces,
} = await import("../lib/db/schema.ts")
const { ConversationCommandApplicationService } =
  await import("../lib/thread-chat/application/conversation-command-service.ts")
const { ConversationCommandError } =
  await import("../lib/thread-chat/application/conversation-command-contracts.ts")
const {
  CanonicalGenerationApplicationService,
  InMemoryGenerationAbortRegistry,
} =
  await import("../lib/thread-chat/generation/canonical-generation-execution.ts")
const { emptyConversationGenerationCheckpoint } =
  await import("../lib/thread-chat/domain/conversation-generation.ts")
const {
  conversationId,
  generationId,
  messageId,
  projectId,
  threadForkId,
  threadId,
  turnId,
  workspaceId,
} = await import("../lib/thread-chat/domain/conversation-model.ts")
const { DrizzleConversationCommandStore } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-command-store.ts")
const { DrizzleConversationGenerationRepository } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-generation-repository.ts")
const { DrizzleConversationOutboxDispatcher } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-outbox-dispatcher.ts")
const { DrizzleConversationRepository } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-repository.ts")
const { assertConversationCommandApiEnabled } =
  await import("../lib/thread-chat/persistence/conversation-command-policy.ts")

const runId = randomUUID()
const prefix = `command-api-test:${runId}`
const ownerId = `${prefix}:owner`
const outsiderId = `${prefix}:outsider`
const workspace = workspaceId(`${prefix}:workspace`)
const project = projectId(`${prefix}:project`)
const conversation = conversationId(`${prefix}:conversation`)
const root = threadId(`${prefix}:thread:root`)
const modelId = "glm-5.3"
const policy = {
  authority: "isolated-test" as const,
  legacyAuthorityEnabled: true,
}
const store = new DrizzleConversationCommandStore(policy)
const generationRepository = new DrizzleConversationGenerationRepository({
  authority: "isolated-test",
  legacyAuthorityEnabled: true,
})
const scheduled: string[][] = []
const scheduler = {
  schedule(eventIds: readonly string[]) {
    scheduled.push([...eventIds])
  },
  async dispatchPending() {
    return 0
  },
}
const service = new ConversationCommandApplicationService(
  store,
  store,
  generationRepository,
  scheduler
)
const seedRepository = new DrizzleConversationRepository({
  writeMode: "isolated-test",
  legacyWritesEnabled: true,
})

let commandSequence = 0
function command<TPayload>(input: {
  scope:
    | { type: "project"; id: ReturnType<typeof projectId> }
    | { type: "conversation"; id: ReturnType<typeof conversationId> }
    | { type: "thread"; id: ReturnType<typeof threadId> }
    | { type: "turn"; id: ReturnType<typeof turnId> }
  payload: TPayload
  expectedRevision?: number
  key?: string
  actorUserId?: string
}) {
  commandSequence += 1
  return {
    commandId: `${prefix}:command:${commandSequence}`,
    actor: {
      kind: "user" as const,
      userId: input.actorUserId ?? ownerId,
    },
    scope: input.scope,
    idempotencyKey: input.key ?? `key-${commandSequence}`,
    ...(input.expectedRevision !== undefined
      ? { expectedRevision: input.expectedRevision }
      : {}),
    payload: input.payload,
  }
}

function content(text: string) {
  return {
    schemaVersion: 1 as const,
    parts: [{ type: "text" as const, text }],
  }
}

async function expectCode(
  code: string,
  action: () => Promise<unknown>
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(
      error instanceof ConversationCommandError,
      error instanceof Error
        ? `${error.name}: ${error.message}; cause: ${String(error.cause)}`
        : String(error)
    )
    assert.equal(error.code, code)
    return true
  })
}

async function finalizeCompleted(
  targetGenerationId: ReturnType<typeof generationId>
) {
  const generation = await generationRepository.getGeneration({
    ownerId,
    generationId: targetGenerationId,
  })
  assert.ok(generation)
  const body = `完成:${targetGenerationId}`
  return generationRepository.finalizeGeneration({
    generationId: targetGenerationId,
    leaseOwner: generation.leaseOwner ?? "missing-lease",
    expectedCheckpointVersion: generation.checkpointVersion,
    outcome: "completed",
    checkpoint: {
      ...emptyConversationGenerationCheckpoint(),
      body,
      contentState: "complete",
    },
    usageCompleteness: "unavailable",
    knownUsage: null,
  })
}

function sendPayload(
  targetThreadId: ReturnType<typeof threadId>,
  suffix: string
) {
  return {
    conversationId: conversation,
    turnId: turnId(`${prefix}:turn:${suffix}`),
    userMessageId: messageId(`${prefix}:message:${suffix}:user`),
    assistantMessageId: messageId(`${prefix}:message:${suffix}:assistant`),
    generationId: generationId(`${prefix}:generation:${suffix}`),
    content: content(`用户消息:${suffix}`),
    modelId,
    targetThreadId,
  }
}

let assertions = 0
try {
  assert.throws(
    () =>
      assertConversationCommandApiEnabled({
        authority: "disabled",
        legacyAuthorityEnabled: true,
      }),
    (error: unknown) =>
      error instanceof ConversationCommandError && error.code === "not_found"
  )
  assert.throws(
    () =>
      assertConversationCommandApiEnabled({
        authority: "canonical",
        legacyAuthorityEnabled: true,
      }),
    (error: unknown) =>
      error instanceof ConversationCommandError &&
      error.code === "state_conflict"
  )
  assertions += 2

  await db.insert(user).values([
    {
      id: ownerId,
      name: "Command API Owner",
      email: `${runId}-owner@command-api.invalid`,
      emailVerified: true,
    },
    {
      id: outsiderId,
      name: "Command API Outsider",
      email: `${runId}-outsider@command-api.invalid`,
      emailVerified: true,
    },
  ])
  await seedRepository.createWorkspace({
    workspace: { id: workspace, revision: 0, lifecycle: "active" },
    ownerUserId: ownerId,
  })
  await seedRepository.createProject({
    actorUserId: ownerId,
    project: {
      id: project,
      workspaceId: workspace,
      title: "Command API Test",
      revision: 0,
      lifecycle: "active",
    },
  })

  const create = command({
    scope: { type: "project", id: project },
    payload: {
      conversationId: conversation,
      rootThreadId: root,
      title: "规范命令测试",
      modelId,
    },
    key: "create-conversation",
  })
  const [createA, createB] = await Promise.all([
    service.createConversation(create),
    service.createConversation(create),
  ])
  assert.equal([createA.replayed, createB.replayed].filter(Boolean).length, 1)
  assert.deepEqual(
    await service.listConversations({
      actorUserId: outsiderId,
      projectId: project,
    }),
    []
  )
  assert.equal(
    await service.getConversationSnapshot({
      actorUserId: outsiderId,
      conversationId: conversation,
    }),
    null
  )
  await expectCode("idempotency_conflict", () =>
    service.createConversation({
      ...create,
      payload: { ...create.payload, title: "不同载荷" },
    })
  )
  await expectCode("not_found", () =>
    service.renameConversation(
      command({
        actorUserId: outsiderId,
        scope: { type: "conversation", id: conversation },
        expectedRevision: 0,
        payload: { title: "越权重命名" },
      })
    )
  )
  assertions += 5

  const rename = command({
    scope: { type: "conversation", id: conversation },
    expectedRevision: 0,
    payload: { title: "已重命名" },
  })
  const renamed = await service.renameConversation(rename)
  assert.equal(renamed.revisions[conversation], 1)
  await expectCode("version_conflict", () =>
    service.renameConversation(
      command({
        scope: { type: "conversation", id: conversation },
        expectedRevision: 0,
        payload: { title: "旧版本" },
      })
    )
  )
  assertions += 2

  const rootSend = sendPayload(root, "root")
  const rootSendCommand = command({
    scope: { type: "thread", id: root },
    expectedRevision: 0,
    key: "send-root",
    payload: {
      conversationId: conversation,
      turnId: rootSend.turnId,
      userMessageId: rootSend.userMessageId,
      assistantMessageId: rootSend.assistantMessageId,
      generationId: rootSend.generationId,
      content: rootSend.content,
      modelId,
    },
  })
  const rootSendRaceCommand = command({
    scope: { type: "thread", id: root },
    expectedRevision: 0,
    key: "send-root-race",
    payload: rootSendCommand.payload,
  })
  const rootSendOutcomes = await Promise.allSettled([
    service.sendTurn(rootSendCommand),
    service.sendTurn(rootSendRaceCommand),
  ])
  const rootSendSuccesses = rootSendOutcomes.filter(
    (
      outcome
    ): outcome is PromiseFulfilledResult<
      Awaited<ReturnType<typeof service.sendTurn>>
    > => outcome.status === "fulfilled"
  )
  const rootSendFailures = rootSendOutcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
  )
  assert.equal(rootSendSuccesses.length, 1)
  assert.equal(rootSendFailures.length, 1)
  assert.ok(rootSendFailures[0]?.reason instanceof ConversationCommandError)
  assert.equal(rootSendFailures[0]?.reason.code, "version_conflict")
  const winningRootSendCommand =
    rootSendOutcomes[0]?.status === "fulfilled"
      ? rootSendCommand
      : rootSendRaceCommand
  const sentRoot = rootSendSuccesses[0]!.value
  assert.equal(sentRoot.replayed, false)
  assert.equal(scheduled.length, 1)
  const replayedRoot = await service.sendTurn(winningRootSendCommand)
  assert.equal(replayedRoot.replayed, true)
  assert.equal(scheduled.length, 1)
  const rootGeneration = await service.getGeneration({
    actorUserId: ownerId,
    generationId: rootSend.generationId,
  })
  assert.equal(rootGeneration?.status, "running")
  let localAbortCalled = false
  const stopRequested = await service.stopGeneration({
    actorUserId: ownerId,
    generationId: rootSend.generationId,
    notifyLocalAbort: () => {
      localAbortCalled = true
    },
  })
  assert.equal(stopRequested?.status, "stop_requested")
  assert.equal(localAbortCalled, true)
  const stopped = await generationRepository.finalizeGeneration({
    generationId: rootSend.generationId,
    leaseOwner: rootGeneration?.leaseOwner ?? "missing",
    expectedCheckpointVersion: 0,
    outcome: "stopped",
    checkpoint: emptyConversationGenerationCheckpoint(),
    usageCompleteness: "unavailable",
    knownUsage: null,
  })
  assert.equal(stopped?.status, "stopped")
  assertions += 12

  const threadA = threadId(`${prefix}:thread:A`)
  const forkACommand = command({
    scope: { type: "thread", id: root },
    expectedRevision: 1,
    key: "fork-A",
    payload: {
      conversationId: conversation,
      forkId: threadForkId(`${prefix}:fork:A`),
      childThreadId: threadA,
      sourceMessageId: rootSend.userMessageId,
      modelId,
      localTitle: "A",
    },
  })
  const forkARaceCommand = command({
    scope: { type: "thread", id: root },
    expectedRevision: 1,
    key: "fork-A-race",
    payload: forkACommand.payload,
  })
  const forkAOutcomes = await Promise.allSettled([
    service.forkThread(forkACommand),
    service.forkThread(forkARaceCommand),
  ])
  const forkASuccesses = forkAOutcomes.filter(
    (
      outcome
    ): outcome is PromiseFulfilledResult<
      Awaited<ReturnType<typeof service.forkThread>>
    > => outcome.status === "fulfilled"
  )
  const forkAFailures = forkAOutcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
  )
  assert.equal(forkASuccesses.length, 1)
  assert.equal(forkAFailures.length, 1)
  assert.ok(forkAFailures[0]?.reason instanceof ConversationCommandError)
  assert.equal(forkAFailures[0]?.reason.code, "version_conflict")
  const forkA = forkASuccesses[0]!.value
  assert.equal(forkA.revisions[conversation], 2)
  assertions += 4

  const sendA = sendPayload(threadA, "A")
  await service.sendTurn(
    command({
      scope: { type: "thread", id: threadA },
      expectedRevision: 0,
      payload: {
        conversationId: conversation,
        turnId: sendA.turnId,
        userMessageId: sendA.userMessageId,
        assistantMessageId: sendA.assistantMessageId,
        generationId: sendA.generationId,
        content: sendA.content,
        modelId,
      },
    })
  )
  assert.equal(
    (await finalizeCompleted(sendA.generationId))?.status,
    "completed"
  )
  const renamedA = await service.renameThread(
    command({
      scope: { type: "thread", id: threadA },
      expectedRevision: 1,
      payload: { title: "A 已重命名" },
    })
  )
  assert.equal(renamedA.revisions[threadA], 2)

  const threadB = threadId(`${prefix}:thread:B`)
  await service.forkThread(
    command({
      scope: { type: "thread", id: threadA },
      expectedRevision: 2,
      payload: {
        conversationId: conversation,
        forkId: threadForkId(`${prefix}:fork:B`),
        childThreadId: threadB,
        sourceMessageId: sendA.assistantMessageId,
        modelId,
        localTitle: "B",
      },
    })
  )
  const sendB = sendPayload(threadB, "B1")
  await service.sendTurn(
    command({
      scope: { type: "thread", id: threadB },
      expectedRevision: 0,
      payload: {
        conversationId: conversation,
        turnId: sendB.turnId,
        userMessageId: sendB.userMessageId,
        assistantMessageId: sendB.assistantMessageId,
        generationId: sendB.generationId,
        content: sendB.content,
        modelId,
      },
    })
  )
  assert.equal(
    (await finalizeCompleted(sendB.generationId))?.status,
    "completed"
  )
  const threadC = threadId(`${prefix}:thread:C`)
  await service.forkThread(
    command({
      scope: { type: "thread", id: threadB },
      expectedRevision: 3,
      payload: {
        conversationId: conversation,
        forkId: threadForkId(`${prefix}:fork:C`),
        childThreadId: threadC,
        sourceMessageId: sendB.assistantMessageId,
        modelId,
        localTitle: "C",
      },
    })
  )
  const nested = await service.getConversationSnapshot({
    actorUserId: ownerId,
    conversationId: conversation,
  })
  assert.ok(nested)
  assert.deepEqual(nested.contextMessageIdsByThread[threadC], [
    rootSend.userMessageId,
    sendA.userMessageId,
    sendA.assistantMessageId,
    sendB.userMessageId,
    sendB.assistantMessageId,
  ])
  assert.equal(Object.keys(nested.snapshot.messages).length, 6)
  assertions += 7

  const [forkCountBefore] = await db
    .select({ value: count(conversationThreads.id) })
    .from(conversationThreads)
    .where(eq(conversationThreads.conversationId, conversation))
  const [eventCountBefore] = await db
    .select({ value: count(conversationOutboxEvents.id) })
    .from(conversationOutboxEvents)
    .where(eq(conversationOutboxEvents.actorId, ownerId))
  await expectCode("semantic_validation", () =>
    service.forkThread(
      command({
        scope: { type: "thread", id: threadB },
        expectedRevision: 4,
        payload: {
          conversationId: conversation,
          forkId: threadForkId(`${prefix}:fork:invalid`),
          childThreadId: threadId(`${prefix}:thread:invalid`),
          sourceMessageId: rootSend.userMessageId,
          modelId,
        },
      })
    )
  )
  const [forkCountAfter] = await db
    .select({ value: count(conversationThreads.id) })
    .from(conversationThreads)
    .where(eq(conversationThreads.conversationId, conversation))
  assert.equal(forkCountAfter?.value, forkCountBefore?.value)
  const [eventCountAfter] = await db
    .select({ value: count(conversationOutboxEvents.id) })
    .from(conversationOutboxEvents)
    .where(eq(conversationOutboxEvents.actorId, ownerId))
  assert.equal(eventCountAfter?.value, eventCountBefore?.value)
  assertions += 3

  const beforeRegenerate = await service.getConversationSnapshot({
    actorUserId: ownerId,
    conversationId: conversation,
  })
  assert.ok(beforeRegenerate)
  const turnB1 = beforeRegenerate.snapshot.turns[sendB.turnId]
  assert.ok(turnB1)
  const regeneratedAssistant = messageId(`${prefix}:message:B1:assistant:regen`)
  const regeneratedGeneration = generationId(`${prefix}:generation:B1:regen`)
  await service.regenerateTurn(
    command({
      scope: { type: "turn", id: sendB.turnId },
      expectedRevision: turnB1.revision,
      payload: {
        conversationId: conversation,
        assistantMessageId: regeneratedAssistant,
        generationId: regeneratedGeneration,
        sourceAssistantMessageId: sendB.assistantMessageId,
        modelId,
      },
    })
  )
  const regenerated = await finalizeCompleted(regeneratedGeneration)
  assert.equal(regenerated?.status, "completed")
  await service.selectTurnVariant(
    command({
      scope: { type: "turn", id: sendB.turnId },
      expectedRevision: 3,
      payload: {
        conversationId: conversation,
        messageId: sendB.assistantMessageId,
        role: "assistant" as const,
      },
    })
  )
  const selected = await service.getConversationSnapshot({
    actorUserId: ownerId,
    conversationId: conversation,
  })
  assert.equal(
    selected?.snapshot.turns[sendB.turnId]?.activeAssistantMessageId,
    sendB.assistantMessageId
  )
  assertions += 4

  const sendB2 = sendPayload(threadB, "B2")
  await service.sendTurn(
    command({
      scope: { type: "thread", id: threadB },
      expectedRevision: 1,
      payload: {
        conversationId: conversation,
        turnId: sendB2.turnId,
        userMessageId: sendB2.userMessageId,
        assistantMessageId: sendB2.assistantMessageId,
        generationId: sendB2.generationId,
        content: sendB2.content,
        modelId,
      },
    })
  )
  await finalizeCompleted(sendB2.generationId)
  await expectCode("fork_required", () =>
    service.editTurnInput(
      command({
        scope: { type: "turn", id: sendB.turnId },
        expectedRevision: 4,
        payload: {
          conversationId: conversation,
          userMessageId: messageId(`${prefix}:message:B1:user:edit`),
          assistantMessageId: messageId(`${prefix}:message:B1:assistant:edit`),
          generationId: generationId(`${prefix}:generation:B1:edit`),
          sourceUserMessageId: sendB.userMessageId,
          content: content("非法历史编辑"),
          modelId,
        },
      })
    )
  )
  const editedUser = messageId(`${prefix}:message:B2:user:edit`)
  const editedAssistant = messageId(`${prefix}:message:B2:assistant:edit`)
  const editedGeneration = generationId(`${prefix}:generation:B2:edit`)
  await service.editTurnInput(
    command({
      scope: { type: "turn", id: sendB2.turnId },
      expectedRevision: 1,
      payload: {
        conversationId: conversation,
        userMessageId: editedUser,
        assistantMessageId: editedAssistant,
        generationId: editedGeneration,
        sourceUserMessageId: sendB2.userMessageId,
        content: content("合法尾部编辑"),
        modelId,
      },
    })
  )
  await finalizeCompleted(editedGeneration)
  const editedSnapshot = await service.getConversationSnapshot({
    actorUserId: ownerId,
    conversationId: conversation,
  })
  assert.equal(
    editedSnapshot?.snapshot.turns[sendB2.turnId]?.activeUserMessageId,
    editedUser
  )
  assertions += 3

  await expectCode("conversation_action_required", () =>
    service.setThreadLifecycle(
      command({
        scope: { type: "thread", id: root },
        expectedRevision: 1,
        payload: { lifecycle: "archived" as const },
      })
    )
  )
  const archivedC = await service.setThreadLifecycle(
    command({
      scope: { type: "thread", id: threadC },
      expectedRevision: 0,
      payload: { lifecycle: "archived" as const },
    })
  )
  assert.equal(archivedC.revisions[threadC], 1)
  await service.setThreadLifecycle(
    command({
      scope: { type: "thread", id: threadC },
      expectedRevision: 1,
      payload: { lifecycle: "active" as const },
    })
  )
  assertions += 3

  const runningC = sendPayload(threadC, "C-running")
  await service.sendTurn(
    command({
      scope: { type: "thread", id: threadC },
      expectedRevision: 2,
      payload: {
        conversationId: conversation,
        turnId: runningC.turnId,
        userMessageId: runningC.userMessageId,
        assistantMessageId: runningC.assistantMessageId,
        generationId: runningC.generationId,
        content: runningC.content,
        modelId,
      },
    })
  )
  await expectCode("state_conflict", () =>
    service.deleteConversation(
      command({
        scope: { type: "conversation", id: conversation },
        expectedRevision: 4,
        payload: {},
      })
    )
  )
  await service.stopGeneration({
    actorUserId: ownerId,
    generationId: runningC.generationId,
    notifyLocalAbort: () => {},
  })
  const runningRecord = await generationRepository.getGeneration({
    ownerId,
    generationId: runningC.generationId,
  })
  await generationRepository.finalizeGeneration({
    generationId: runningC.generationId,
    leaseOwner: runningRecord?.leaseOwner ?? "missing",
    expectedCheckpointVersion: 0,
    outcome: "stopped",
    checkpoint: emptyConversationGenerationCheckpoint(),
    usageCompleteness: "unavailable",
    knownUsage: null,
  })
  assertions += 2

  const executorProbe = sendPayload(threadC, "C-executor")
  await service.sendTurn(
    command({
      scope: { type: "thread", id: threadC },
      expectedRevision: 3,
      payload: {
        conversationId: conversation,
        turnId: executorProbe.turnId,
        userMessageId: executorProbe.userMessageId,
        assistantMessageId: executorProbe.assistantMessageId,
        generationId: executorProbe.generationId,
        content: executorProbe.content,
        modelId,
      },
    })
  )
  const executionService = new CanonicalGenerationApplicationService(
    generationRepository,
    {
      async execute({ generation, onCheckpoint }) {
        await onCheckpoint({
          ...emptyConversationGenerationCheckpoint(),
          body: "执行",
          contentState: "streaming",
        })
        return {
          outcome: "completed" as const,
          checkpoint: {
            ...emptyConversationGenerationCheckpoint(),
            body: `执行完成:${generation.id}`,
            contentState: "complete" as const,
          },
          usageCompleteness: "unavailable" as const,
          knownUsage: null,
        }
      },
    },
    new InMemoryGenerationAbortRegistry(),
    { checkpointThrottleMs: 0 }
  )

  const consumed: string[] = []
  const dispatcher = new DrizzleConversationOutboxDispatcher(
    {
      async consume(event) {
        consumed.push(event.id)
        if (event.type !== "GenerationRequested") return
        const payload = event.payload as {
          generationId: string
          ownerId: string
          leaseOwner: string
        }
        const generation = await generationRepository.getGeneration({
          ownerId: payload.ownerId,
          generationId: generationId(payload.generationId),
        })
        assert.ok(generation)
        await executionService.executeExisting(generation, payload.leaseOwner)
      },
    },
    `${prefix}:dispatcher`
  )
  const firstDispatch = await dispatcher.dispatchPending({ limit: 100 })
  const secondDispatch = await dispatcher.dispatchPending({ limit: 100 })
  assert.ok(firstDispatch > 0)
  assert.equal(secondDispatch, 0)
  assert.equal(new Set(consumed).size, consumed.length)
  const [pending] = await db
    .select({ value: count(conversationOutboxEvents.id) })
    .from(conversationOutboxEvents)
    .where(eq(conversationOutboxEvents.actorId, ownerId))
  assert.equal(pending?.value, consumed.length)
  const executed = await generationRepository.getGeneration({
    ownerId,
    generationId: executorProbe.generationId,
  })
  assert.equal(executed?.status, "completed")
  assert.equal(
    executed?.checkpoint.body,
    `执行完成:${executorProbe.generationId}`
  )
  assertions += 6

  const [commandCount] = await db
    .select({ value: count(conversationCommandRecords.id) })
    .from(conversationCommandRecords)
    .where(eq(conversationCommandRecords.actorId, ownerId))
  assert.ok((commandCount?.value ?? 0) > 10)
  assertions += 1

  const archivedConversation = await service.setConversationLifecycle(
    command({
      scope: { type: "conversation", id: conversation },
      expectedRevision: 4,
      payload: { lifecycle: "archived" as const },
    })
  )
  assert.equal(archivedConversation.revisions[conversation], 5)
  assert.equal(
    (
      await service.listConversations({
        actorUserId: ownerId,
        projectId: project,
      })
    ).length,
    0
  )
  await service.setConversationLifecycle(
    command({
      scope: { type: "conversation", id: conversation },
      expectedRevision: 5,
      payload: { lifecycle: "active" as const },
    })
  )
  const deleted = await service.deleteConversation(
    command({
      scope: { type: "conversation", id: conversation },
      expectedRevision: 6,
      payload: {},
    })
  )
  assert.deepEqual(deleted.delta.remove.conversations, [conversation])
  assert.equal(
    await service.getConversationSnapshot({
      actorUserId: ownerId,
      conversationId: conversation,
    }),
    null
  )
  assertions += 5

  console.log(
    JSON.stringify({
      ok: true,
      assertions,
      topology: "root → A → B → C",
      outboxExactlyOnce: true,
      noWholeTreeWrite: true,
      model: modelId,
    })
  )
} finally {
  await db
    .delete(conversationGenerations)
    .where(eq(conversationGenerations.workspaceId, workspace))
  await db.delete(workspaces).where(eq(workspaces.id, workspace))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.delete(user).where(eq(user.id, outsiderId))
  await globalThis.__dbClient?.end()
  globalThis.__dbClient = undefined
}
