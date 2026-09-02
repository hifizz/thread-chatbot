import assert from "node:assert/strict"
import test from "node:test"
import {
  assistantMessageTraceId,
  feedbackScoreId,
} from "../../lib/observability/identity.ts"
import {
  mirrorMessageFeedback,
  prepareFeedbackScore,
} from "../../lib/observability/feedback-score.ts"
import { backfillFeedbackScores } from "../../lib/observability/feedback-backfill.ts"
import { scheduleFeedbackMirrorAfterCommit } from "../../lib/observability/feedback-post-commit.ts"
import { drainFeedbackScoreOutbox } from "../../lib/observability/feedback-outbox.ts"

const messageId = "9ee270ad-314f-44d9-a69a-0df461dfb3a9"

function createFakeClient() {
  const scores = new Map()
  let flushes = 0
  return {
    scores,
    get flushes() {
      return flushes
    },
    score: {
      create(score) {
        scores.set(score.id, structuredClone(score))
      },
    },
    async flush() {
      flushes += 1
    },
  }
}

function input(feedback, updatedAt = "2026-08-28T00:00:00.000Z") {
  return { messageId, feedback, updatedAt }
}

test("feedback Score IDs and Trace IDs are deterministic", async () => {
  const first = await prepareFeedbackScore(input("up"), "test")
  const second = await prepareFeedbackScore(input("down"), "test")
  assert.equal(first.id, second.id)
  assert.equal(first.id, await feedbackScoreId(messageId))
  assert.equal(first.traceId, await assistantMessageTraceId(messageId))
  assert.equal(first.dataType, "CATEGORICAL")
  assert.deepEqual(first.metadata, {
    source: "thread-chat.product-db",
    sourceEntity: "assistant-message",
    sourceUpdatedAt: "2026-08-28T00:00:00.000Z",
    sourceVersion: 0,
    schemaVersion: "feedback-score-v2",
  })
})

function createFakeOutbox(value = "up") {
  const row = {
    messageId,
    value,
    sourceUpdatedAt: new Date("2026-08-28T00:00:00.000Z"),
    version: 1,
    deliveredVersion: 0,
    attempts: 0,
    nextAttemptAt: new Date("2026-08-28T00:00:00.000Z"),
    lockToken: null,
    lockedUntil: null,
  }
  return {
    row,
    enqueue(nextValue, updatedAt) {
      row.value = nextValue
      row.sourceUpdatedAt = updatedAt
      row.version += 1
      row.attempts = 0
      row.nextAttemptAt = updatedAt
    },
    async claim({ now }) {
      if (
        row.deliveredVersion >= row.version ||
        row.nextAttemptAt > now ||
        (row.lockedUntil && row.lockedUntil > now)
      ) {
        return []
      }
      row.lockToken = crypto.randomUUID()
      row.lockedUntil = new Date(now.getTime() + 30_000)
      return [
        {
          messageId: row.messageId,
          value: row.value,
          sourceUpdatedAt: row.sourceUpdatedAt,
          version: row.version,
          attempts: row.attempts,
          lockToken: row.lockToken,
        },
      ]
    },
    async succeed(item) {
      if (row.version === item.version && row.lockToken === item.lockToken) {
        row.deliveredVersion = item.version
        row.lockToken = null
        row.lockedUntil = null
        return "acknowledged"
      }
      if (row.lockToken === item.lockToken) {
        row.lockToken = null
        row.lockedUntil = null
      }
      return "superseded"
    },
    async fail({ item, nextAttemptAt }) {
      if (row.version === item.version && row.lockToken === item.lockToken) {
        row.attempts += 1
        row.nextAttemptAt = nextAttemptAt
        row.lockToken = null
        row.lockedUntil = null
        return "rescheduled"
      }
      if (row.lockToken === item.lockToken) {
        row.lockToken = null
        row.lockedUntil = null
      }
      return "superseded"
    },
  }
}

test("outbox version confirmation prevents an old worker acknowledging a newer clear", async () => {
  const store = createFakeOutbox("up")
  let releaseOld
  const oldRemote = new Promise((resolve) => {
    releaseOld = resolve
  })
  const sent = []
  const firstDrain = drainFeedbackScoreOutbox({
    store,
    now: new Date("2026-08-28T00:00:01.000Z"),
    mirror: async (value) => {
      sent.push({ feedback: value.feedback, version: value.version })
      await oldRemote
      return { status: "mirrored", traceId: "t", scoreId: "s", value: "up" }
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  store.enqueue("cleared", new Date("2026-08-28T00:00:02.000Z"))

  const concurrent = await drainFeedbackScoreOutbox({
    store,
    now: new Date("2026-08-28T00:00:03.000Z"),
    mirror: async () =>
      assert.fail("new version must wait for the active lease"),
  })
  assert.equal(concurrent.claimed, 0)
  releaseOld()
  const stale = await firstDrain
  assert.equal(stale.superseded, 1)
  assert.equal(store.row.deliveredVersion, 0)

  const latest = await drainFeedbackScoreOutbox({
    store,
    now: new Date("2026-08-28T00:00:04.000Z"),
    mirror: async (value) => {
      sent.push({ feedback: value.feedback, version: value.version })
      return {
        status: "mirrored",
        traceId: "t",
        scoreId: "s",
        value: "cleared",
      }
    },
  })
  assert.equal(latest.mirrored, 1)
  assert.equal(store.row.deliveredVersion, 2)
  assert.deepEqual(sent, [
    { feedback: "up", version: 1 },
    { feedback: null, version: 2 },
  ])
})

test("outbox retry state survives a failed drain and is reclaimable later", async () => {
  const store = createFakeOutbox("down")
  const failed = await drainFeedbackScoreOutbox({
    store,
    now: new Date("2026-08-28T00:00:01.000Z"),
    mirror: async () => ({ status: "failed", errorCategory: "timeout" }),
  })
  assert.equal(failed.retried, 1)
  assert.equal(store.row.attempts, 1)

  const early = await drainFeedbackScoreOutbox({
    store,
    now: new Date("2026-08-28T00:00:02.000Z"),
    mirror: async () => assert.fail("backoff must remain durable"),
  })
  assert.equal(early.claimed, 0)

  const recovered = await drainFeedbackScoreOutbox({
    store,
    now: new Date("2026-08-28T00:00:07.000Z"),
    mirror: async () => ({
      status: "mirrored",
      traceId: "t",
      scoreId: "s",
      value: "down",
    }),
  })
  assert.equal(recovered.mirrored, 1)
  assert.equal(store.row.deliveredVersion, 1)
})

test("first, repeated, changed, and cleared feedback keep one logical Score", async () => {
  const client = createFakeClient()
  const dependencies = { getClient: async () => client }

  await mirrorMessageFeedback(input("up"), dependencies)
  await mirrorMessageFeedback(input("up"), dependencies)
  await mirrorMessageFeedback(input("down"), dependencies)
  const cleared = await mirrorMessageFeedback(input(null), dependencies)

  assert.equal(client.scores.size, 1)
  assert.equal([...client.scores.values()][0].value, "cleared")
  assert.equal(cleared.status, "mirrored")
  assert.equal(client.flushes, 4)
})

test("Score creation is allowed before a matching Trace has arrived", async () => {
  const client = createFakeClient()
  const result = await mirrorMessageFeedback(input("down"), {
    getClient: async () => client,
  })
  assert.equal(result.status, "mirrored")
  assert.equal(client.scores.size, 1)
})

test("Langfuse exception and timeout never escape the mirror", async () => {
  const exception = await mirrorMessageFeedback(input("up"), {
    getClient: async () => ({
      score: { create() {} },
      async flush() {
        throw new Error("remote unavailable with secret details")
      },
    }),
  })
  assert.equal(exception.status, "failed")

  const timeout = await mirrorMessageFeedback(input("up"), {
    getClient: async () => ({
      score: { create() {} },
      flush: () => new Promise(() => {}),
    }),
    timeoutMs: 5,
  })
  assert.deepEqual(timeout, { status: "failed", errorCategory: "timeout" })
})

test("post-commit hook only schedules work and does not await the mirror", () => {
  const tasks = []
  scheduleFeedbackMirrorAfterCommit(
    { id: messageId, feedback: "up", updatedAt: "2026-08-28T00:00:00.000Z" },
    (task) => tasks.push(task)
  )
  assert.equal(tasks.length, 1)
})

test("backfill is dry-run by default and replay is idempotent", async () => {
  const rows = [
    { id: messageId, feedback: "up", updatedAt: new Date("2026-08-28") },
    {
      id: "827b35a4-c1e1-4dc2-8644-62a6df8ac612",
      feedback: "down",
      updatedAt: new Date("2026-08-28"),
    },
  ]
  let calls = 0
  const dryRun = await backfillFeedbackScores(rows, {
    mirror: async () => {
      calls += 1
      return { status: "queued", traceId: "t", scoreId: "s", value: "up" }
    },
  })
  assert.equal(dryRun.processed, 2)
  assert.equal(dryRun.samples.length, 2)
  assert.equal(calls, 0)

  const client = createFakeClient()
  const run = () =>
    backfillFeedbackScores(rows, {
      dryRun: false,
      batchSize: 1,
      mirror: (value) =>
        mirrorMessageFeedback(value, {
          getClient: async () => client,
          flush: false,
        }),
      flush: async () => {
        await client.flush()
        return "flushed"
      },
    })
  const first = await run()
  const second = await run()
  assert.equal(client.scores.size, 2)
  assert.equal(first.mirrored, 2)
  assert.equal(second.mirrored, 2)
  assert.equal(first.flush, "flushed")
  assert.equal(client.flushes, 2)
})
