import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { config } from "dotenv"

config({ path: ".env.local" })
process.env.CONVERSATION_GENERATION_AUTHORITY = "isolated-test"

const { count, eq } = await import("drizzle-orm")
const { db } = await import("../lib/db/index.ts")
const {
  conversationGenerations,
  conversationMessages,
  conversationTurns,
  usageRecords,
  user,
  userCredits,
  workspaces,
} = await import("../lib/db/schema.ts")
const { CanonicalGenerationServiceError } =
  await import("../lib/thread-chat/application/conversation-generation-service.ts")
const { emptyConversationGenerationCheckpoint } =
  await import("../lib/thread-chat/domain/conversation-generation.ts")
const {
  conversationId,
  generationId,
  messageId,
  projectId,
  threadId,
  turnId,
  workspaceId,
} = await import("../lib/thread-chat/domain/conversation-model.ts")
const {
  CanonicalGenerationApplicationService,
  InMemoryGenerationAbortRegistry,
} =
  await import("../lib/thread-chat/generation/canonical-generation-execution.ts")
const { DrizzleConversationGenerationRepository } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-generation-repository.ts")
const { DrizzleConversationRepository } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-repository.ts")
const { assertCanonicalGenerationEnabled } =
  await import("../lib/thread-chat/persistence/canonical-generation-policy.ts")

const runId = randomUUID()
const prefix = `generation-test:${runId}`
const userId = `${prefix}:user`
const workspace = workspaceId(`${prefix}:workspace`)
const project = projectId(`${prefix}:project`)
const conversation = conversationId(`${prefix}:conversation`)
const thread = threadId(`${prefix}:thread`)
const turn = turnId(`${prefix}:turn`)
const inputMessage = messageId(`${prefix}:message:user`)
const initialAssistant = messageId(`${prefix}:message:assistant:initial`)
const modelId = "glm-5.3"

const conversationRepository = new DrizzleConversationRepository({
  writeMode: "isolated-test",
  legacyWritesEnabled: true,
})
const generationRepository = new DrizzleConversationGenerationRepository({
  authority: "isolated-test",
  legacyAuthorityEnabled: true,
})

function content(text: string) {
  return {
    schemaVersion: 1 as const,
    parts: text ? [{ type: "text" as const, text }] : [],
  }
}

function checkpoint(
  input: {
    body?: string
    artifactIds?: string[]
    activityStatus?: "running" | "complete" | "error" | "stopped"
    knownUsage?: {
      inputTokens: number
      outputTokens: number
      paidStepCount: number
      reportedStepCount: number
    } | null
    contentState?:
      "pending" | "streaming" | "complete" | "incomplete" | "failed"
  } = {}
) {
  return {
    ...emptyConversationGenerationCheckpoint(),
    body: input.body ?? "",
    artifactIds: input.artifactIds ?? [],
    researchPlan: input.activityStatus ? { query: "架构资料" } : null,
    researchActivities: input.activityStatus
      ? [
          {
            id: "research-1",
            kind: "search",
            status: input.activityStatus,
            sources: [{ url: "https://example.invalid/source" }],
          },
        ]
      : [],
    contentState: input.contentState ?? "streaming",
    knownUsage: input.knownUsage ?? null,
  }
}

async function turnRevision(): Promise<number> {
  const [row] = await db
    .select({ revision: conversationTurns.revision })
    .from(conversationTurns)
    .where(eq(conversationTurns.id, turn))
  assert.ok(row)
  return row.revision
}

let sequence = 0
async function startInput(
  overrides: {
    generation?: ReturnType<typeof generationId>
    output?: ReturnType<typeof messageId>
    key?: string
    hash?: string
    workspaceId?: ReturnType<typeof workspaceId>
    leaseOwner?: string
    outputText?: string
    variantOfMessageId?: ReturnType<typeof messageId> | null
  } = {}
) {
  sequence += 1
  const generation =
    overrides.generation ?? generationId(`${prefix}:generation:${sequence}`)
  const output =
    overrides.output ?? messageId(`${prefix}:message:assistant:${sequence}`)
  return {
    id: generation,
    ownerId: userId,
    workspaceId: overrides.workspaceId ?? workspace,
    projectId: project,
    conversationId: conversation,
    threadId: thread,
    turnId: turn,
    inputMessageId: inputMessage,
    outputMessage: {
      id: output,
      threadId: thread,
      turnId: turn,
      role: "assistant" as const,
      content: content(overrides.outputText ?? ""),
      contentState: "pending" as const,
      variantOfMessageId:
        overrides.variantOfMessageId === null
          ? undefined
          : (overrides.variantOfMessageId ?? initialAssistant),
      createdAt: new Date().toISOString(),
    },
    intent: { kind: "send" as const },
    requestHash: overrides.hash ?? `hash-${sequence}`,
    idempotencyKey: overrides.key ?? `key-${sequence}`,
    modelId,
    expectedTurnRevision: await turnRevision(),
    leaseOwner: overrides.leaseOwner ?? `worker-${sequence}`,
  }
}

async function expectServiceCode(
  code: string,
  action: () => Promise<unknown>
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof CanonicalGenerationServiceError)
    assert.equal(error.code, code)
    return true
  })
}

async function expectDatabaseConstraint(
  expectedConstraint: string,
  action: () => Promise<unknown>
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    let current: unknown = error
    let constraint: string | undefined
    while (current && typeof current === "object") {
      const candidate = current as {
        cause?: unknown
        constraint?: unknown
        constraint_name?: unknown
      }
      const value = candidate.constraint ?? candidate.constraint_name
      if (typeof value === "string") {
        constraint = value
        break
      }
      current = candidate.cause
    }
    assert.equal(constraint, expectedConstraint)
    return true
  })
}

function abortError() {
  const error = new Error("aborted")
  error.name = "AbortError"
  return error
}

let assertions = 0
try {
  assert.throws(
    () =>
      assertCanonicalGenerationEnabled({
        authority: "disabled",
        legacyAuthorityEnabled: true,
      }),
    (error: unknown) =>
      error instanceof CanonicalGenerationServiceError &&
      error.code === "forbidden"
  )
  assert.throws(
    () =>
      assertCanonicalGenerationEnabled({
        authority: "canonical",
        legacyAuthorityEnabled: true,
      }),
    (error: unknown) =>
      error instanceof CanonicalGenerationServiceError &&
      error.code === "forbidden"
  )
  assertions += 2

  await db.insert(user).values({
    id: userId,
    name: "Conversation Generation Test",
    email: `${runId}@conversation-generation.invalid`,
    emailVerified: true,
  })
  await conversationRepository.createWorkspace({
    workspace: { id: workspace, revision: 0, lifecycle: "active" },
    ownerUserId: userId,
  })
  await conversationRepository.createProject({
    actorUserId: userId,
    project: {
      id: project,
      workspaceId: workspace,
      title: "Generation 生命周期测试",
      revision: 0,
      lifecycle: "active",
    },
  })
  await conversationRepository.createConversation({
    actorUserId: userId,
    projectId: project,
    conversation: {
      id: conversation,
      rootThreadId: thread,
      autoTitle: "Generation 测试",
      customTitle: null,
      revision: 0,
      lifecycle: "active",
    },
    rootThread: {
      id: thread,
      conversationId: conversation,
      modelId,
      localTitle: null,
      revision: 0,
      lifecycle: "active",
    },
  })
  await conversationRepository.appendTurn({
    actorUserId: userId,
    conversationId: conversation,
    expectedThreadRevision: 0,
    turn: {
      id: turn,
      threadId: thread,
      position: 0,
      activeUserMessageId: inputMessage,
      activeAssistantMessageId: initialAssistant,
      revision: 0,
    },
    userMessage: {
      id: inputMessage,
      threadId: thread,
      turnId: turn,
      role: "user",
      content: content("请验证规范 Generation 生命周期"),
      contentState: "complete",
      createdAt: new Date().toISOString(),
    },
    assistantMessage: {
      id: initialAssistant,
      threadId: thread,
      turnId: turn,
      role: "assistant",
      content: content("初始占位"),
      contentState: "pending",
      createdAt: new Date().toISOString(),
    },
  })

  // 开始、幂等重放、载荷冲突、跨层级身份拒绝。
  const idempotentInput = await startInput({
    output: initialAssistant,
    outputText: "初始占位",
    variantOfMessageId: null,
  })
  const concurrentStarts = await Promise.all([
    generationRepository.startGeneration(idempotentInput),
    generationRepository.startGeneration(idempotentInput),
  ])
  const first = concurrentStarts.find((result) => result.created)
  const replay = concurrentStarts.find((result) => !result.created)
  assert.ok(first)
  assert.ok(replay)
  assert.equal(first.created, true)
  assert.equal(replay.created, false)
  assert.equal(replay.generation.id, first.generation.id)
  const [confirmedOutputCount] = await db
    .select({ value: count(conversationMessages.id) })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, initialAssistant))
  assert.equal(confirmedOutputCount?.value, 1)
  await expectServiceCode("idempotency_conflict", () =>
    generationRepository.startGeneration({
      ...idempotentInput,
      requestHash: "different-hash",
    })
  )
  const invalidOutput = messageId(`${prefix}:message:invalid-workspace`)
  const invalidIdentityInput = await startInput({
    output: invalidOutput,
    workspaceId: workspaceId(`${prefix}:wrong-workspace`),
  })
  await expectServiceCode("invalid_identity", () =>
    generationRepository.startGeneration(invalidIdentityInput)
  )
  const [orphanOutput] = await db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, invalidOutput))
  assert.equal(orphanOutput, undefined)
  assertions += 7

  // 结束第一条，避免它影响后续 current-attempt 测试。
  await generationRepository.finalizeGeneration({
    generationId: first.generation.id,
    leaseOwner: idempotentInput.leaseOwner,
    expectedCheckpointVersion: 0,
    outcome: "failed",
    checkpoint: checkpoint({ contentState: "failed" }),
    usageCompleteness: "unavailable",
    knownUsage: null,
    errorCode: "fixture_finished",
  })

  // 断线语义：调用方不等待 execution，服务端仍可查询 running 并最终完成。
  let releaseDisconnect!: () => void
  const disconnectGate = new Promise<void>((resolve) => {
    releaseDisconnect = resolve
  })
  let modelObservedCommitted = false
  const disconnectService = new CanonicalGenerationApplicationService(
    generationRepository,
    {
      async execute({ generation, onCheckpoint }) {
        const queried = await generationRepository.getGeneration({
          ownerId: userId,
          generationId: generation.id,
        })
        modelObservedCommitted = queried?.status === "running"
        await onCheckpoint(
          checkpoint({
            body: "流式正文",
            artifactIds: ["artifact-1"],
            activityStatus: "running",
          })
        )
        await releaseAfter(disconnectGate)
        return {
          outcome: "completed",
          checkpoint: checkpoint({
            body: "流式正文完成",
            artifactIds: ["artifact-1"],
            activityStatus: "complete",
            contentState: "complete",
          }),
          usageCompleteness: "complete",
          knownUsage: {
            inputTokens: 11,
            outputTokens: 7,
            paidStepCount: 1,
            reportedStepCount: 1,
          },
        }
      },
    },
    new InMemoryGenerationAbortRegistry(),
    { checkpointThrottleMs: 0, heartbeatMs: 50 }
  )
  const disconnectInput = await startInput()
  const disconnected = await disconnectService.start(disconnectInput)
  assert.ok(disconnected.execution)
  await waitFor(async () => {
    const value = await disconnectService.query({
      ownerId: userId,
      generationId: disconnectInput.id,
    })
    return value?.checkpoint.body === "流式正文"
  })
  const runningAfterConsumerDetach = await disconnectService.query({
    ownerId: userId,
    generationId: disconnectInput.id,
  })
  assert.equal(runningAfterConsumerDetach?.status, "running")
  assert.equal(
    runningAfterConsumerDetach?.checkpoint.researchActivities[0]?.status,
    "running"
  )
  assert.equal(modelObservedCommitted, true)
  const staleWhileRunning = await generationRepository.saveCheckpoint({
    generationId: disconnectInput.id,
    leaseOwner: disconnectInput.leaseOwner,
    expectedVersion: 0,
    checkpoint: checkpoint({ body: "旧正文" }),
  })
  assert.equal(staleWhileRunning.kind, "conflict")
  await expectServiceCode("checkpoint_conflict", () =>
    generationRepository.saveCheckpoint({
      generationId: disconnectInput.id,
      leaseOwner: disconnectInput.leaseOwner,
      expectedVersion: runningAfterConsumerDetach?.checkpointVersion ?? -1,
      checkpoint: checkpoint({ body: "流式正文" }),
    })
  )
  releaseDisconnect()
  const disconnectedResult = await disconnected.execution
  assert.equal(disconnectedResult?.status, "completed")
  assert.equal(disconnectedResult?.billingStatus, "settled")
  assertions += 8

  // checkpoint CAS：旧版本不能覆盖正文、Artifact 或 running 活动。
  const staleCheckpointResult = await generationRepository.saveCheckpoint({
    generationId: disconnectInput.id,
    leaseOwner: disconnectInput.leaseOwner,
    expectedVersion: 0,
    checkpoint: checkpoint({ body: "旧正文" }),
  })
  assert.equal(staleCheckpointResult.kind, "terminal")
  const [disconnectMessage] = await db
    .select({ content: conversationMessages.content })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, disconnectInput.outputMessage.id))
  assert.ok(
    disconnectMessage?.content.parts.some(
      (part) => part.type === "artifact-reference"
    )
  )
  assertions += 2

  // Stop：先持久化后本地 abort；保留 partial，并保持 usage 真实。
  const stopRegistry = new InMemoryGenerationAbortRegistry()
  const stopService = new CanonicalGenerationApplicationService(
    generationRepository,
    {
      async execute({ signal, onCheckpoint }) {
        await onCheckpoint(
          checkpoint({
            body: "停止前已知内容",
            activityStatus: "running",
            knownUsage: {
              inputTokens: 5,
              outputTokens: 2,
              paidStepCount: 2,
              reportedStepCount: 1,
            },
          })
        )
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(abortError()), {
            once: true,
          })
        })
        assert.fail("abort 后不应继续")
      },
    },
    stopRegistry,
    { checkpointThrottleMs: 0, heartbeatMs: 50 }
  )
  const stopInput = await startInput()
  const stopping = await stopService.start(stopInput)
  assert.ok(stopping.execution)
  await waitFor(async () => {
    const value = await stopService.query({
      ownerId: userId,
      generationId: stopInput.id,
    })
    return value?.checkpoint.body === "停止前已知内容"
  })
  const remoteStopService = new CanonicalGenerationApplicationService(
    generationRepository,
    { execute: async () => assert.fail("Stop 命令不执行模型") },
    new InMemoryGenerationAbortRegistry(),
    { heartbeatMs: 50 }
  )
  const stopRequested = await remoteStopService.stop({
    ownerId: userId,
    generationId: stopInput.id,
  })
  assert.equal(stopRequested?.status, "stop_requested")
  const stopped = await stopping.execution
  assert.equal(stopped?.status, "stopped")
  assert.equal(stopped?.contentState, "incomplete")
  assert.equal(stopped?.usageCompleteness, "partial")
  assert.equal(stopped?.billingStatus, "usage_unavailable")
  const repeatedStop = await remoteStopService.stop({
    ownerId: userId,
    generationId: stopInput.id,
  })
  assert.equal(repeatedStop?.status, "stopped")
  const [persistedStoppedMessage] = await db
    .select({
      content: conversationMessages.content,
      contentState: conversationMessages.contentState,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, stopInput.outputMessage.id))
  assert.equal(persistedStoppedMessage?.contentState, "incomplete")
  assert.ok(
    persistedStoppedMessage?.content.parts.some(
      (part) => part.type === "text" && part.text === "停止前已知内容"
    )
  )
  assert.ok(
    persistedStoppedMessage?.content.parts.some(
      (part) =>
        part.type === "structured" && part.kind === "research-activities"
    )
  )
  assertions += 10

  // 无输出失败。
  const failureService = new CanonicalGenerationApplicationService(
    generationRepository,
    {
      async execute() {
        throw new Error("model_failed")
      },
    },
    new InMemoryGenerationAbortRegistry(),
    { checkpointThrottleMs: 0, heartbeatMs: 50 }
  )
  const failureInput = await startInput()
  const failing = await failureService.start(failureInput)
  assert.ok(failing.execution)
  const failed = await failing.execution
  assert.equal(failed?.status, "failed")
  assert.equal(failed?.contentState, "failed")
  assertions += 2

  // 进程崩溃/stale claim 使用最新 checkpoint；健康完成后不能再 claim。
  const staleInput = await startInput()
  const staleStarted = await generationRepository.startGeneration(staleInput)
  assert.equal(staleStarted.created, true)
  assert.equal(
    await generationRepository.markPaidCallStarted({
      generationId: staleInput.id,
      leaseOwner: staleInput.leaseOwner,
    }),
    true
  )
  const stalePartial = checkpoint({
    body: "崩溃前 checkpoint",
    activityStatus: "running",
  })
  const staleSaved = await generationRepository.saveCheckpoint({
    generationId: staleInput.id,
    leaseOwner: staleInput.leaseOwner,
    expectedVersion: 0,
    checkpoint: stalePartial,
  })
  assert.equal(staleSaved.kind, "saved")
  await db
    .update(conversationGenerations)
    .set({ heartbeatAt: new Date(0) })
    .where(eq(conversationGenerations.id, staleInput.id))
  const convergenceService = new CanonicalGenerationApplicationService(
    generationRepository,
    { execute: async () => assert.fail("stale 收敛不调用模型") },
    new InMemoryGenerationAbortRegistry(),
    { leaseMs: 1, now: () => Date.now() }
  )
  const converged = await convergenceService.convergeStale({
    generationId: staleInput.id,
    leaseOwner: "recovery-worker",
  })
  assert.equal(converged?.status, "failed")
  assert.equal(converged?.contentState, "incomplete")
  assert.equal(converged?.checkpoint.body, "崩溃前 checkpoint")
  assert.equal(
    await convergenceService.convergeStale({
      generationId: staleInput.id,
      leaseOwner: "second-recovery-worker",
    }),
    null
  )
  assert.equal(
    await convergenceService.convergeStale({
      generationId: disconnectInput.id,
      leaseOwner: "cannot-claim-completed",
    }),
    null
  )
  assertions += 8

  // 旧尝试晚到：新尝试先成为 current，旧结果不能覆盖 Turn 当前变体。
  const oldInput = await startInput()
  const oldStarted = await generationRepository.startGeneration(oldInput)
  assert.equal(oldStarted.created, true)
  await generationRepository.markPaidCallStarted({
    generationId: oldInput.id,
    leaseOwner: oldInput.leaseOwner,
  })
  const newInput = await startInput()
  const newStarted = await generationRepository.startGeneration(newInput)
  assert.equal(newStarted.created, true)
  const oldLate = await generationRepository.finalizeGeneration({
    generationId: oldInput.id,
    leaseOwner: oldInput.leaseOwner,
    expectedCheckpointVersion: 0,
    outcome: "completed",
    checkpoint: checkpoint({ body: "旧结果晚到", contentState: "complete" }),
    usageCompleteness: "complete",
    knownUsage: {
      inputTokens: 2,
      outputTokens: 2,
      paidStepCount: 1,
      reportedStepCount: 1,
    },
  })
  assert.equal(oldLate?.status, "superseded")
  const [turnBeforeNewFinalize] = await db
    .select({ active: conversationTurns.activeAssistantMessageId })
    .from(conversationTurns)
    .where(eq(conversationTurns.id, turn))
  assert.notEqual(turnBeforeNewFinalize?.active, oldInput.outputMessage.id)
  await generationRepository.finalizeGeneration({
    generationId: newInput.id,
    leaseOwner: newInput.leaseOwner,
    expectedCheckpointVersion: 0,
    outcome: "completed",
    checkpoint: checkpoint({ body: "新结果", contentState: "complete" }),
    usageCompleteness: "unavailable",
    knownUsage: null,
  })
  const [turnAfterNewFinalize] = await db
    .select({ active: conversationTurns.activeAssistantMessageId })
    .from(conversationTurns)
    .where(eq(conversationTurns.id, turn))
  assert.equal(turnAfterNewFinalize?.active, newInput.outputMessage.id)
  assertions += 5

  // 完整 usage 重复终结只产生一条流水、一次扣费；partial 不产生流水。
  const partialUsageCount = await db
    .select({ value: count(usageRecords.id) })
    .from(usageRecords)
    .where(eq(usageRecords.appGenerationId, stopInput.id))
  assert.equal(partialUsageCount[0]?.value, 0)
  const completeUsageCount = await db
    .select({ value: count(usageRecords.id) })
    .from(usageRecords)
    .where(eq(usageRecords.appGenerationId, disconnectInput.id))
  assert.equal(completeUsageCount[0]?.value, 1)
  const [balanceBeforeReplay] = await db
    .select({ value: userCredits.balanceMicros })
    .from(userCredits)
    .where(eq(userCredits.userId, userId))
  await Promise.all([
    generationRepository.finalizeGeneration({
      generationId: disconnectInput.id,
      leaseOwner: disconnectInput.leaseOwner,
      expectedCheckpointVersion: disconnectedResult?.checkpointVersion ?? 0,
      outcome: "completed",
      checkpoint: disconnectedResult?.checkpoint ?? checkpoint(),
      usageCompleteness: "complete",
      knownUsage: disconnectedResult?.knownUsage ?? null,
    }),
    generationRepository.finalizeGeneration({
      generationId: disconnectInput.id,
      leaseOwner: disconnectInput.leaseOwner,
      expectedCheckpointVersion: disconnectedResult?.checkpointVersion ?? 0,
      outcome: "completed",
      checkpoint: disconnectedResult?.checkpoint ?? checkpoint(),
      usageCompleteness: "complete",
      knownUsage: disconnectedResult?.knownUsage ?? null,
    }),
  ])
  const [countAfterReplay] = await db
    .select({ value: count(usageRecords.id) })
    .from(usageRecords)
    .where(eq(usageRecords.appGenerationId, disconnectInput.id))
  const [balanceAfterReplay] = await db
    .select({ value: userCredits.balanceMicros })
    .from(userCredits)
    .where(eq(userCredits.userId, userId))
  assert.equal(countAfterReplay?.value, 1)
  assert.equal(balanceAfterReplay?.value, balanceBeforeReplay?.value)
  assertions += 4

  // 数据库独立拒绝非法状态组合和错误 Message 角色。
  const invalidStateInput = await startInput()
  const invalidStateStarted =
    await generationRepository.startGeneration(invalidStateInput)
  assert.equal(invalidStateStarted.created, true)
  await expectDatabaseConstraint(
    "conversation_generations_terminal_time_ck",
    () =>
      db
        .update(conversationGenerations)
        .set({
          status: "completed",
          contentState: "complete",
          billingStatus: "not_billable",
        })
        .where(eq(conversationGenerations.id, invalidStateInput.id))
  )
  await expectDatabaseConstraint("conversation_generations_input_role_ck", () =>
    db
      .update(conversationGenerations)
      .set({ inputMessageId: invalidStateInput.outputMessage.id })
      .where(eq(conversationGenerations.id, invalidStateInput.id))
  )
  await expectDatabaseConstraint(
    "conversation_generations_conversation_project_fk",
    () =>
      db
        .update(conversationGenerations)
        .set({
          conversationId: conversationId(`${prefix}:wrong-conversation`),
        })
        .where(eq(conversationGenerations.id, invalidStateInput.id))
  )
  assertions += 4

  console.log(
    JSON.stringify({
      ok: true,
      assertions,
      authority: "isolated-test",
      model: modelId,
      exactlyOnceBilling: true,
      browserDisconnectKeepsExecution: true,
    })
  )
} finally {
  await db
    .delete(conversationGenerations)
    .where(eq(conversationGenerations.workspaceId, workspace))
  await db.delete(workspaces).where(eq(workspaces.id, workspace))
  await db.delete(user).where(eq(user.id, userId))
  await globalThis.__dbClient?.end()
  globalThis.__dbClient = undefined
}

async function releaseAfter(promise: Promise<void>): Promise<void> {
  await promise
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`等待条件超时（${timeoutMs}ms）`)
}
