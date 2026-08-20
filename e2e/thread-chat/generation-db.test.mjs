import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import {
  branchGenerations,
  branchTrees,
  usageRecords,
  user,
} from "../../lib/db/schema.ts"
import {
  ensureUserCredits,
  getBalanceMicros,
} from "../../lib/billing/credits.ts"
import { finalizeGeneration } from "../../lib/thread-chat-generation/finalize.ts"
import { observeGenerationCancellation } from "../../lib/thread-chat-generation/execution.ts"
import {
  GenerationRepositoryError,
  startGeneration,
} from "../../lib/thread-chat-generation/start-generation-repository.ts"
import { requestGenerationStop } from "../../lib/thread-chat-generation/execution-state-repository.ts"
import { failStaleGenerationsForTree } from "../../lib/thread-chat-generation/stale-generation-repository.ts"
import {
  getGenerationForOwner,
  listCurrentGenerationsForTree,
} from "../../lib/thread-chat-generation/query-repository.ts"
import {
  GENERATION_CANCEL_POLL_MS,
  GENERATION_LEASE_MS,
} from "../../constants/generation.ts"

const suffix = randomUUID()
const userId = `generation-db-test-${suffix}`
const otherUserId = `generation-db-test-other-${suffix}`
const treeId = randomUUID()
const otherTreeId = randomUUID()
const generations = Array.from({ length: 7 }, () => randomUUID())

function stateFor(generationId) {
  return {
    schemaVersion: 2,
    seq: 3,
    tick: 1,
    recents: [],
    threads: {
      main: {
        id: "main",
        modelId: "glm-5.2",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        lastActive: 1,
        activeLeafMessageId: "m2",
        messages: [
          {
            id: "m1",
            parentMessageId: null,
            role: "user",
            text: "测试问题",
            forks: [],
          },
          {
            id: "m2",
            parentMessageId: "m1",
            role: "assistant",
            text: "",
            forks: [],
            generationId,
            status: "pending",
          },
        ],
      },
    },
    artifacts: {},
    artifactOrder: [],
    footnoteCounter: 0,
  }
}

function startInput(generationId) {
  return {
    userId,
    treeId,
    threadId: "main",
    userMessageId: "m1",
    assistantMessageId: "m2",
    generationId,
    modelId: "glm-5.2",
    intent: { kind: "persisted-turn" },
  }
}

function alternateTurnState(generationId, activeGenerationId) {
  const state = stateFor(activeGenerationId)
  state.threads.main.messages.push(
    {
      id: "m3",
      parentMessageId: null,
      role: "user",
      text: "另一个标签页的问题",
      forks: [],
    },
    {
      id: "m4",
      parentMessageId: "m3",
      role: "assistant",
      text: "",
      forks: [],
      generationId,
      status: "pending",
    }
  )
  state.threads.main.activeLeafMessageId = "m4"
  return state
}

function resultFor(generationId, text = "测试回复") {
  return {
    version: 1,
    generationId,
    text,
    status: "done",
    artifactIds: [],
    artifacts: {},
  }
}

async function persistPlaceholder(generationId) {
  await db
    .update(branchTrees)
    .set({ state: stateFor(generationId), updatedAt: new Date() })
    .where(eq(branchTrees.id, treeId))
}

async function run() {
  await db.insert(user).values([
    {
      id: userId,
      name: "generation db test",
      email: `${userId}@example.test`,
      emailVerified: true,
    },
    {
      id: otherUserId,
      name: "generation db other",
      email: `${otherUserId}@example.test`,
      emailVerified: true,
    },
  ])
  await db.insert(branchTrees).values([
    {
      id: treeId,
      userId,
      title: "generation db test",
      state: stateFor(generations[0]),
    },
    {
      id: otherTreeId,
      userId: otherUserId,
      title: "generation db other",
      state: stateFor(generations[6]),
    },
  ])

  const concurrentReplay = await Promise.all([
    startGeneration(startInput(generations[0])),
    startGeneration(startInput(generations[0])),
  ])
  assert.equal(
    concurrentReplay.filter((entry) => entry.created).length,
    1,
    "并发重复 start 只能创建一次"
  )
  assert.equal(
    (await listCurrentGenerationsForTree(userId, treeId)).length,
    1,
    "同一 assistant slot 只能有一个 current generation"
  )
  assert.equal(
    await getGenerationForOwner(otherUserId, generations[0]),
    null,
    "跨用户查询应表现为 404/null"
  )
  assert.equal(
    await requestGenerationStop(otherUserId, generations[0]),
    null,
    "跨用户 Stop 应表现为 404/null"
  )

  await startGeneration({
    ...startInput(generations[6]),
    userId: otherUserId,
    treeId: otherTreeId,
  })
  await persistPlaceholder(generations[6])
  await assert.rejects(
    startGeneration(startInput(generations[6])),
    (error) =>
      error instanceof GenerationRepositoryError &&
      error.code === "generation_conflict",
    "跨用户 generation ID 碰撞必须返回受控冲突"
  )

  const changedModelState = stateFor(generations[0])
  changedModelState.threads.main.modelId = "deepseek-v4-pro"
  await db
    .update(branchTrees)
    .set({ state: changedModelState, updatedAt: new Date() })
    .where(eq(branchTrees.id, treeId))
  const replayAfterModelChange = await startGeneration(
    startInput(generations[0])
  )
  assert.equal(
    replayAfterModelChange.created,
    false,
    "已创建 generation 的幂等重放不得依赖树的后续模型状态"
  )

  await db
    .update(branchTrees)
    .set({
      state: alternateTurnState(generations[5], generations[0]),
      updatedAt: new Date(),
    })
    .where(eq(branchTrees.id, treeId))
  await assert.rejects(
    startGeneration({
      ...startInput(generations[5]),
      userMessageId: "m3",
      assistantMessageId: "m4",
    }),
    (error) =>
      error instanceof GenerationRepositoryError &&
      error.code === "generation_conflict",
    "同一 thread 的另一 active generation 必须阻止普通 start"
  )
  assert.equal(
    await getGenerationForOwner(userId, generations[5]),
    null,
    "被拒绝的普通 start 不得建立第二条付费 generation"
  )

  await persistPlaceholder(generations[1])
  const second = await startGeneration(startInput(generations[1]))
  assert.equal(second.generation.attempt, 2)
  assert.equal(
    (await getGenerationForOwner(userId, generations[0])).status,
    "superseded",
    "新 attempt 必须 supersede 旧 current"
  )
  const currentAfterRetry = await listCurrentGenerationsForTree(userId, treeId)
  assert.deepEqual(
    currentAfterRetry.map((row) => row.id),
    [generations[1]]
  )

  await Promise.all([
    requestGenerationStop(userId, generations[1]),
    finalizeGeneration({
      generationId: generations[1],
      outcome: "completed",
      result: resultFor(generations[1]),
      usageUnavailable: true,
    }),
  ])
  const stopRace = await getGenerationForOwner(userId, generations[1])
  assert.ok(
    stopRace.status === "completed" || stopRace.status === "stopped",
    "Stop-vs-complete 必须收敛到唯一终态"
  )

  await persistPlaceholder(generations[2])
  await startGeneration(startInput(generations[2]))
  const now = new Date()
  await db
    .update(branchGenerations)
    .set({
      heartbeatAt: new Date(now.getTime() - GENERATION_LEASE_MS - 1_000),
      updatedAt: new Date(now.getTime() - GENERATION_LEASE_MS - 1_000),
    })
    .where(eq(branchGenerations.id, generations[2]))
  assert.equal(await failStaleGenerationsForTree(userId, treeId, now), 1)
  assert.equal(
    (await getGenerationForOwner(userId, generations[2])).status,
    "failed",
    "过期 heartbeat 必须收敛 failed"
  )
  const terminalController = new AbortController()
  const terminalObserver = observeGenerationCancellation(
    generations[2],
    terminalController
  )
  await new Promise((resolve) =>
    setTimeout(resolve, GENERATION_CANCEL_POLL_MS + 250)
  )
  terminalObserver.stop()
  await terminalObserver.done
  assert.equal(
    terminalController.signal.aborted,
    true,
    "DB 已收敛终态时仍在运行的执行必须由 observer 中止"
  )
  const staleBeforeLateFinalize = await getGenerationForOwner(
    userId,
    generations[2]
  )
  await finalizeGeneration({
    generationId: generations[2],
    outcome: "completed",
    result: resultFor(generations[2], "租约失败后的迟到结果"),
    usage: { inputTokens: 80, outputTokens: 20 },
  })
  const staleAfterLateFinalize = await getGenerationForOwner(
    userId,
    generations[2]
  )
  assert.equal(staleAfterLateFinalize.status, "failed")
  assert.deepEqual(
    staleAfterLateFinalize.result,
    staleBeforeLateFinalize.result,
    "迟到 finalize 不得用完成结果改写用户已看到的租约失败"
  )
  assert.equal(
    staleAfterLateFinalize.billingStatus,
    "settled",
    "迟到的权威 usage 仍必须完成幂等记账"
  )
  assert.equal(
    (
      await db
        .select()
        .from(usageRecords)
        .where(eq(usageRecords.appGenerationId, generations[2]))
    ).length,
    1,
    "迟到 usage 只能生成一条记账记录"
  )

  await ensureUserCredits(userId)
  const balanceBefore = await getBalanceMicros(userId)
  await persistPlaceholder(generations[3])
  await startGeneration(startInput(generations[3]))
  await persistPlaceholder(generations[4])
  await startGeneration(startInput(generations[4]))
  assert.equal(
    (await getGenerationForOwner(userId, generations[3])).status,
    "superseded"
  )

  const supersededResult = resultFor(generations[3], "旧 attempt 的审计结果")
  await Promise.all([
    finalizeGeneration({
      generationId: generations[3],
      outcome: "completed",
      result: supersededResult,
      usage: { inputTokens: 120, outputTokens: 45 },
    }),
    finalizeGeneration({
      generationId: generations[3],
      outcome: "completed",
      result: supersededResult,
      usage: { inputTokens: 120, outputTokens: 45 },
    }),
  ])
  const usage = await db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.appGenerationId, generations[3]))
  assert.equal(usage.length, 1, "finalize 重入只能产生一条 usage")
  assert.equal(
    balanceBefore - (await getBalanceMicros(userId)),
    usage[0].priceMicros,
    "finalize 重入只能扣费一次"
  )
  const superseded = await getGenerationForOwner(userId, generations[3])
  assert.equal(superseded.status, "superseded")
  assert.equal(superseded.result.text, "旧 attempt 的审计结果")
  assert.equal(superseded.billingStatus, "settled")

  await finalizeGeneration({
    generationId: generations[3],
    outcome: "failed",
    result: supersededResult,
  })
  const supersededAfterUsageFreeReplay = await getGenerationForOwner(
    userId,
    generations[3]
  )
  assert.equal(
    supersededAfterUsageFreeReplay.billingStatus,
    "settled",
    "无 usage 的重复 finalize 不得降级既有 settled 账单"
  )
  assert.equal(
    (
      await db
        .select()
        .from(usageRecords)
        .where(eq(usageRecords.appGenerationId, generations[3]))
    ).length,
    1,
    "无 usage 的重复 finalize 不得改变已结算流水"
  )

  await finalizeGeneration({
    generationId: generations[4],
    outcome: "completed",
    result: resultFor(generations[4]),
    usageUnavailable: true,
  })
  const active = await db
    .select({ id: branchGenerations.id })
    .from(branchGenerations)
    .where(
      and(
        eq(branchGenerations.treeId, treeId),
        eq(branchGenerations.status, "running")
      )
    )
  assert.equal(active.length, 0)

  console.log(
    "PASS  repository 并发重放/current、Stop 竞态、supersede、stale、越权与 finalize 幂等计费"
  )
}

try {
  await run()
} finally {
  await db.delete(user).where(eq(user.id, userId))
  await db.delete(user).where(eq(user.id, otherUserId))
}
