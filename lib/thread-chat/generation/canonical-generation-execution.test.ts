import assert from "node:assert/strict"
import test from "node:test"

import type {
  CanonicalGenerationExecutor,
  CanonicalGenerationRecord,
  CanonicalGenerationRepository,
  FinalizeCanonicalGenerationInput,
  StartCanonicalGenerationInput,
} from "../application/conversation-generation-service.ts"
import { emptyConversationGenerationCheckpoint } from "../domain/conversation-generation.ts"
import {
  conversationId,
  generationId,
  messageId,
  projectId,
  threadId,
  turnId,
  workspaceId,
} from "../domain/conversation-model.ts"
import {
  CanonicalGenerationApplicationService,
  InMemoryGenerationAbortRegistry,
} from "./canonical-generation-execution.ts"

function fixture() {
  const checkpoint = emptyConversationGenerationCheckpoint()
  const record: CanonicalGenerationRecord = {
    id: generationId("generation-1"),
    ownerId: "user-1",
    workspaceId: workspaceId("workspace-1"),
    projectId: projectId("project-1"),
    conversationId: conversationId("conversation-1"),
    threadId: threadId("thread-1"),
    turnId: turnId("turn-1"),
    inputMessageId: messageId("message-user-1"),
    outputMessageId: messageId("message-assistant-1"),
    intent: { kind: "send" },
    requestHash: "hash-1",
    idempotencyKey: "key-1",
    modelId: "ark-glm-5.3",
    attempt: 1,
    isCurrent: true,
    status: "running",
    contentState: "pending",
    billingStatus: "pending",
    checkpointVersion: 0,
    checkpoint,
    knownUsage: null,
    usageCompleteness: "unavailable",
    paidCallStarted: false,
    leaseOwner: "worker-1",
    leaseVersion: 0,
    heartbeatAt: "2026-08-22T00:00:00.000Z",
    stopRequestedAt: null,
    startedAt: "2026-08-22T00:00:00.000Z",
    finishedAt: null,
    errorCode: null,
    createdAt: "2026-08-22T00:00:00.000Z",
  }
  const input: StartCanonicalGenerationInput = {
    id: record.id,
    ownerId: record.ownerId,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    conversationId: record.conversationId,
    threadId: record.threadId,
    turnId: record.turnId,
    inputMessageId: record.inputMessageId,
    outputMessage: {
      id: record.outputMessageId,
      threadId: record.threadId,
      turnId: record.turnId,
      role: "assistant",
      content: { schemaVersion: 1, parts: [] },
      contentState: "pending",
      createdAt: "2026-08-22T00:00:00.000Z",
    },
    intent: record.intent,
    requestHash: record.requestHash,
    idempotencyKey: record.idempotencyKey,
    modelId: record.modelId,
    expectedTurnRevision: 0,
    leaseOwner: "worker-1",
  }
  return { checkpoint, input, record }
}

class FakeRepository implements CanonicalGenerationRepository {
  readonly events: string[] = []
  readonly checkpointBodies: string[] = []
  readonly saved: CanonicalGenerationRecord

  constructor(record: CanonicalGenerationRecord) {
    this.saved = record
  }

  async startGeneration() {
    this.events.push("start-committed")
    return { created: true as const, generation: this.saved }
  }
  async markPaidCallStarted() {
    this.events.push("paid-call-marked")
    return true
  }
  async getGeneration() {
    return this.saved
  }
  async saveCheckpoint(
    input: Parameters<CanonicalGenerationRepository["saveCheckpoint"]>[0]
  ) {
    this.events.push("checkpoint-saved")
    this.checkpointBodies.push(input.checkpoint.body)
    return { kind: "saved" as const, version: input.expectedVersion + 1 }
  }
  async heartbeat() {
    return true
  }
  async requestStop() {
    this.events.push("stop-persisted")
    return { ...this.saved, status: "stop_requested" as const }
  }
  async claimStale() {
    return null
  }
  async finalizeGeneration(input: FinalizeCanonicalGenerationInput) {
    this.events.push(`finalized:${input.outcome}`)
    return { ...this.saved, status: input.outcome }
  }
}

test("开始事务提交后才调用执行器，调用方可与执行 Promise 解耦", async () => {
  const { checkpoint, input, record } = fixture()
  const repository = new FakeRepository(record)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const executor: CanonicalGenerationExecutor = {
    async execute({ onCheckpoint }) {
      repository.events.push("model-called")
      await gate
      await onCheckpoint({
        ...checkpoint,
        body: "断线后仍完成",
        contentState: "streaming",
      })
      return {
        outcome: "completed",
        checkpoint: {
          ...checkpoint,
          body: "断线后仍完成",
          contentState: "complete",
        },
        usageCompleteness: "complete",
        knownUsage: {
          inputTokens: 3,
          outputTokens: 4,
          paidStepCount: 1,
          reportedStepCount: 1,
        },
      }
    },
  }
  const service = new CanonicalGenerationApplicationService(
    repository,
    executor,
    new InMemoryGenerationAbortRegistry(),
    { checkpointThrottleMs: 0, heartbeatMs: 60_000 }
  )
  const started = await service.start(input)
  assert.ok(started.execution)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(repository.events.slice(0, 3), [
    "start-committed",
    "paid-call-marked",
    "model-called",
  ])
  release()
  const completed = await started.execution
  assert.equal(completed?.status, "completed")
  assert.ok(repository.events.includes("checkpoint-saved"))
})

test("高频 checkpoint 被节流合并，终结前强制刷新最新结果", async () => {
  const { checkpoint, input, record } = fixture()
  const repository = new FakeRepository(record)
  const service = new CanonicalGenerationApplicationService(
    repository,
    {
      async execute({ onCheckpoint }) {
        await onCheckpoint({
          ...checkpoint,
          body: "A",
          contentState: "streaming",
        })
        await onCheckpoint({
          ...checkpoint,
          body: "AB",
          contentState: "streaming",
        })
        return {
          outcome: "completed",
          checkpoint: { ...checkpoint, body: "ABC", contentState: "complete" },
          usageCompleteness: "unavailable",
          knownUsage: null,
        }
      },
    },
    new InMemoryGenerationAbortRegistry(),
    { checkpointThrottleMs: 60_000, heartbeatMs: 60_000 }
  )
  const started = await service.start(input)
  assert.ok(started.execution)
  await started.execution
  assert.deepEqual(repository.checkpointBodies, ["ABC"])
  assert.ok(
    repository.events.indexOf("checkpoint-saved") <
      repository.events.indexOf("finalized:completed")
  )
})

test("Stop 先持久化，再通知进程内 AbortController", async () => {
  const { input, record } = fixture()
  const repository = new FakeRepository(record)
  const events = repository.events
  const registry = new InMemoryGenerationAbortRegistry()
  const controller = new AbortController()
  controller.signal.addEventListener("abort", () => events.push("local-abort"))
  registry.register(record.id, controller)
  const service = new CanonicalGenerationApplicationService(
    repository,
    { execute: async () => assert.fail("本测试不应调用执行器") },
    registry
  )
  await service.stop({ ownerId: input.ownerId, generationId: input.id })
  assert.deepEqual(events, ["stop-persisted", "local-abort"])
})
