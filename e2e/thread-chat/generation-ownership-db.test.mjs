import assert from "node:assert/strict"
import { config } from "dotenv"

// 多实例生成所有权（lease）的隔离数据库验收：
// claim CAS、心跳刷新、跨实例停止标志、孤儿判定与陈旧清扫。
config({ path: ".env.local" })
const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")
const testUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
testUrl.pathname = "/thread-chat-normalized-test"
testUrl.searchParams.set(
  "options",
  "-c search_path=thread_chat,public,extensions"
)
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const [
  drizzle,
  { db },
  schema,
  application,
  ownership,
  streaming,
  generation,
  models,
] = await Promise.all([
  import("drizzle-orm"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../lib/thread-chat/application/index.ts"),
  import("../../lib/thread-chat/streaming/generation-ownership.ts"),
  import("../../lib/thread-chat/streaming/index.ts"),
  import("../../constants/generation.ts"),
  import("../../constants/model.ts"),
])
const { and, eq } = drizzle
const id = () => crypto.randomUUID()
const prefix = `lease-${id()}`
const userId = `${prefix}-owner`
const modelId = models.DEFAULT_THREAD_CHAT_MODEL_ID
const cleanupProjectIds = []

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function createUser(idValue, suffix) {
  await db.insert(schema.user).values({
    id: idValue,
    name: `Lease ${suffix}`,
    email: `${prefix}-${suffix}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function seedGeneratingTurn(text = "lease 测试") {
  const projectId = id()
  cleanupProjectIds.push(projectId)
  const rootThreadId = id()
  const start = await application.startProject(userId, {
    commandId: id(),
    projectId,
    rootThreadId,
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    parts: [{ type: "text", text }],
  })
  return {
    projectId,
    threadId: rootThreadId,
    assistantId: start.result.assistantMessage.id,
  }
}

try {
  await createUser(userId, "owner")

  // ---- claim CAS：首个属主成功；活心跳下其他实例接管失败；同一属主重认领成功 ----
  {
    const { assistantId } = await seedGeneratingTurn("claim")
    const first = await ownership.claimGenerationOwnership(
      assistantId,
      "instance-a"
    )
    assert.deepEqual(first, { ownerId: "instance-a" })

    const foreign = await ownership.claimGenerationOwnership(
      assistantId,
      "instance-b"
    )
    assert.equal(foreign, null, "活心跳下其他实例不得接管")

    const reclaim = await ownership.claimGenerationOwnership(
      assistantId,
      "instance-a"
    )
    assert.deepEqual(reclaim, { ownerId: "instance-a" })

    const lease = await ownership.readGenerationLease(assistantId)
    assert.equal(lease.generationOwner, "instance-a")
    assert.ok(lease.generationHeartbeatAt)
    assert.equal(
      ownership.generationHeartbeatLive({
        generationHeartbeatAt: lease.generationHeartbeatAt,
      }),
      true
    )
    assert.equal(
      ownership.generationIsOrphaned({
        generationHeartbeatAt: lease.generationHeartbeatAt,
        updatedAt: lease.updatedAt,
      }),
      false,
      "活心跳不得被判定为孤儿"
    )
  }

  // ---- 陈旧心跳接管 + 清扫谓词 ----
  {
    const { assistantId } = await seedGeneratingTurn("stale")
    await ownership.claimGenerationOwnership(assistantId, "dead-instance")
    // 把心跳回拨到陈旧窗口之外，模拟属主实例崩溃。
    const staleAt = new Date(Date.now() - 120_000)
    await db
      .update(schema.messages)
      .set({ generationHeartbeatAt: staleAt, updatedAt: staleAt })
      .where(eq(schema.messages.id, assistantId))

    assert.equal(
      ownership.generationIsOrphaned({
        generationHeartbeatAt: staleAt,
        updatedAt: staleAt,
      }),
      true
    )

    const takeover = await ownership.claimGenerationOwnership(
      assistantId,
      "instance-b"
    )
    assert.deepEqual(takeover, { ownerId: "instance-b" }, "陈旧属主必须可被接管")

    // 活心跳行不被清扫；陈旧行被清扫为 PROCESS_RESTARTED。
    // 共享测试库可能有其他遗留 generating 行，只断言本测试的行。
    const fresh = await seedGeneratingTurn("fresh")
    await ownership.claimGenerationOwnership(fresh.assistantId, "live-instance")
    await streaming.sweepInterruptedGenerations(new Date(Date.now() + 10_000))
    const freshLease = await ownership.readGenerationLease(fresh.assistantId)
    assert.equal(freshLease.status, "generating", "活心跳生成不得被清扫")

    // 回拨 fresh 行心跳后清扫生效。
    await db
      .update(schema.messages)
      .set({ generationHeartbeatAt: staleAt })
      .where(eq(schema.messages.id, fresh.assistantId))
    const sweptStale = await streaming.sweepInterruptedGenerations()
    assert.ok(sweptStale >= 1)
    const converged = await application.getMessage(userId, fresh.assistantId)
    assert.equal(converged.status, "failed")
    assert.equal(converged.error.code, "PROCESS_RESTARTED")
  }

  // ---- 守望：心跳刷新 + 跨实例停止标志 + 终态后所有权丢失 ----
  {
    const { assistantId } = await seedGeneratingTurn("watch")
    await ownership.claimGenerationOwnership(assistantId, "watcher-instance")
    process.env.FLY_MACHINE_ID ??= ""
    const controller = new AbortController()
    const signals = []
    const watcher = new ownership.GenerationOwnership({
      messageId: assistantId,
      signal: controller.signal,
      onSignal: (reason) => {
        signals.push(reason)
        controller.abort()
      },
      options: { ownerId: "watcher-instance", controlPollMs: 50, heartbeatMs: 120 },
    })
    const before = (await ownership.readGenerationLease(assistantId))
      .generationHeartbeatAt
    watcher.start()
    await sleep(350)
    const after = (await ownership.readGenerationLease(assistantId))
      .generationHeartbeatAt
    assert.ok(after > before, "心跳必须按节拍刷新")

    // 另一实例写入 stopRequestedAt → 守望读到并触发 userStop。
    // 与生产一致：onSignal 中止 signal，后续轮询不再重复触发。
    await application.requestMessageStop(userId, assistantId, {
      commandId: id(),
    })
    await sleep(200)
    assert.deepEqual(signals, [generation.GENERATION_CANCEL_REASONS.userStop])
    await watcher.stop()
    await streaming.failOrphanedGeneratingMessage(assistantId)

    // 终态化后旧守望不得继续心跳：beat 影响 0 行 → discarded + 自停。
    const { assistantId: terminalId } = await seedGeneratingTurn("terminal-watch")
    await ownership.claimGenerationOwnership(terminalId, "watcher-instance")
    const controller2 = new AbortController()
    const signals2 = []
    let lost = false
    const watcher2 = new ownership.GenerationOwnership({
      messageId: terminalId,
      signal: controller2.signal,
      onSignal: (reason) => signals2.push(reason),
      onOwnershipLost: () => {
        lost = true
      },
      options: { ownerId: "watcher-instance", controlPollMs: 50, heartbeatMs: 60 },
    })
    watcher2.start()
    await streaming.finalizeGeneration({
      messageId: terminalId,
      snapshot: {
        id: terminalId,
        role: "assistant",
        metadata: { messageId: terminalId, modelId },
        parts: [{ type: "text", text: "done", state: "done" }],
      },
      status: "stopped",
      finishReason: "stop",
    })
    await sleep(300)
    assert.equal(lost, true, "终态后守望必须感知所有权丢失")
    assert.deepEqual(signals2, [generation.GENERATION_CANCEL_REASONS.discarded])
    const terminal = await ownership.readGenerationLease(terminalId)
    assert.equal(terminal.status, "stopped", "旧守望不得覆盖终态")
    await watcher2.stop()
  }

  console.log("generation ownership lease DB tests passed")
} finally {
  // document_revisions.actorUserId 不级联；documents 级联删除其 revisions。
  if (cleanupProjectIds.length > 0) {
    const { inArray } = drizzle
    await db
      .delete(schema.documents)
      .where(inArray(schema.documents.projectId, cleanupProjectIds))
  }
  await db.delete(schema.user).where(and(eq(schema.user.id, userId)))
  await globalThis.__dbClient?.end({ timeout: 5 })
}
