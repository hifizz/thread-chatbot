import assert from "node:assert/strict"
import { SessionStore } from "../../lib/thread-chat/streaming/session-store.ts"
import { initialAssistantSnapshot } from "../../lib/thread-chat/streaming/stream-session.ts"
import { createSessionSseResponse } from "../../lib/thread-chat/streaming/sse.ts"
import { MessageCheckpointer } from "../../lib/thread-chat/streaming/checkpoint.ts"
import { GENERATION_CANCEL_REASONS } from "../../constants/generation.ts"
import { resolveGenerationTerminalOutcome } from "../../lib/thread-chat/streaming/generation-outcome.ts"

const tick = () => new Promise((resolve) => setImmediate(resolve))

function terminalMessage(id, status = "completed") {
  const now = new Date().toISOString()
  return {
    id,
    projectId: "project",
    threadId: "thread",
    sequence: 2,
    role: "assistant",
    parts: [{ type: "text", text: "done", state: "done" }],
    status,
    modelId: "test/model",
    replacesMessageId: null,
    supersededAt: null,
    feedback: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
  }
}

let now = 1_000
const errors = []
const store = new SessionStore({
  now: () => now,
  terminalTtlMs: 100,
  startCleanupTimer: false,
  onTaskError: (messageId, error) => errors.push([messageId, error]),
})

let release
let runCount = 0
const initial = initialAssistantSnapshot({
  messageId: "assistant-1",
  threadId: "thread",
  modelId: "test/model",
})
const first = store.start({
  messageId: initial.id,
  initialSnapshot: initial,
  run: async (session) => {
    runCount += 1
    await new Promise((resolve) => {
      release = resolve
    })
    const snapshot = {
      ...initial,
      parts: [{ type: "text", text: "done", state: "done" }],
    }
    session.publish({ type: "text-start", id: "text-1" }, snapshot)
    session.finish(terminalMessage(initial.id), snapshot)
  },
})
const duplicate = store.start({
  messageId: initial.id,
  initialSnapshot: initial,
  run: async () => {
    runCount += 100
  },
})
assert.equal(first.started, true)
assert.equal(duplicate.started, false)
await tick()
assert.equal(runCount, 1, "重复 start 不得启动第二个 task")

const eventsA = []
const eventsB = []
const unsubscribeA = store.subscribe(initial.id, (event) => eventsA.push(event))
const unsubscribeB = store.subscribe(initial.id, (event) => eventsB.push(event))
assert.deepEqual(
  eventsA.map((event) => event.type),
  ["snapshot"]
)
assert.equal(eventsA[0].throughSeq, 0)
assert.deepEqual(eventsA[0].replay, [])
unsubscribeA()
release()
await first.session.task
assert.deepEqual(
  eventsA.map((event) => event.type),
  ["snapshot"]
)
assert.deepEqual(
  eventsB.map((event) => event.type),
  ["snapshot", "chunk", "terminal"]
)
assert.equal(eventsB[1].seq, 1)
assert.equal(eventsB[0].message.parts.length, 0)
assert.equal(eventsB[2].message.status, "completed")

const late = []
const unsubscribeLate = store.subscribe(initial.id, (event) => late.push(event))
assert.deepEqual(
  late.map((event) => event.type),
  ["snapshot", "terminal"]
)
assert.equal(late[0].throughSeq, 1)
assert.equal(late[0].replay.length, 1)
assert.equal(late[0].replay[0].seq, 1)
assert.equal(late[0].replay[0].chunk.type, "text-start")
assert.equal(late[0].message.parts[0].text, "done")

const lateSse = createSessionSseResponse({
  store,
  messageId: initial.id,
  heartbeatMs: 5,
})
assert(lateSse)
assert.equal(lateSse.headers.get("x-accel-buffering"), "no")
assert.equal(lateSse.headers.get("cache-control"), "no-cache, no-transform")
const lateSseText = await lateSse.text()
assert(lateSseText.includes('"type":"snapshot"'))
assert(lateSseText.includes('"type":"terminal"'))

now += 101
assert.equal(store.cleanup(), 0, "有订阅者的终态 Session 不得清理")
unsubscribeLate()
unsubscribeB()
assert.equal(store.cleanup(), 1)
assert.equal(store.get(initial.id), null)

let releaseSecondChunk
const raceInitial = initialAssistantSnapshot({
  messageId: "assistant-subscribe-race",
  threadId: "thread",
})
const racing = store.start({
  messageId: raceInitial.id,
  initialSnapshot: raceInitial,
  run: async (session) => {
    const firstSnapshot = {
      ...raceInitial,
      parts: [{ type: "text", text: "one", state: "streaming" }],
    }
    session.publish({ type: "text-start", id: "race-text" }, firstSnapshot)
    await new Promise((resolve) => {
      releaseSecondChunk = resolve
    })
    const secondSnapshot = {
      ...raceInitial,
      parts: [{ type: "text", text: "one-two", state: "done" }],
    }
    session.publish(
      { type: "text-delta", id: "race-text", delta: "-two" },
      secondSnapshot
    )
    session.finish(terminalMessage(raceInitial.id), secondSnapshot)
  },
})
const earlyRaceEvents = []
const unsubscribeEarlyRace = store.subscribe(raceInitial.id, (event) =>
  earlyRaceEvents.push(event)
)
await tick()
const midRaceEvents = []
const unsubscribeMidRace = store.subscribe(raceInitial.id, (event) =>
  midRaceEvents.push(event)
)
assert.equal(midRaceEvents[0].throughSeq, 1)
assert.equal(midRaceEvents[0].replay.length, 1)
assert.equal(midRaceEvents[0].message.parts[0].text, "one")
unsubscribeEarlyRace()
unsubscribeMidRace()
releaseSecondChunk()
await racing.session.task
assert.equal(racing.session.status, "terminal", "零订阅者时后台任务仍必须完成")
const afterRaceEvents = []
store.subscribe(raceInitial.id, (event) => afterRaceEvents.push(event))
assert.equal(afterRaceEvents[0].throughSeq, 2)
assert.deepEqual(
  afterRaceEvents[0].replay.map((entry) => entry.seq),
  [1, 2]
)
assert.equal(afterRaceEvents[0].message.parts[0].text, "one-two")
assert.equal(afterRaceEvents[1].type, "terminal")

const active = store.start({
  messageId: "assistant-active",
  initialSnapshot: initialAssistantSnapshot({
    messageId: "assistant-active",
    threadId: "thread",
  }),
  run: async () => new Promise(() => {}),
})
now += 1_000
assert.equal(store.cleanup(), 0, "running Session 不得按 TTL 误删")
assert.equal(store.get(active.session.messageId), active.session)

const failed = store.start({
  messageId: "assistant-failed-task",
  initialSnapshot: initialAssistantSnapshot({
    messageId: "assistant-failed-task",
    threadId: "thread",
  }),
  run: async () => {
    throw new Error("caught-by-store")
  },
})
await failed.session.task
assert.equal(errors.length, 1, "task Promise 必须在 Store 内 catch")

let observedCancelReason
const cancelled = store.start({
  messageId: "assistant-cancelled",
  initialSnapshot: initialAssistantSnapshot({
    messageId: "assistant-cancelled",
    threadId: "thread",
  }),
  run: async (session) =>
    new Promise((resolve) => {
      session.signal.addEventListener(
        "abort",
        () => {
          observedCancelReason = session.signal.reason
          resolve()
        },
        { once: true }
      )
    }),
})
await tick()
assert.equal(
  store.abort(
    cancelled.session.messageId,
    GENERATION_CANCEL_REASONS.userStop
  ),
  true
)
await cancelled.session.task
assert(observedCancelReason instanceof DOMException)
assert.equal(observedCancelReason.name, "AbortError")
assert.equal(observedCancelReason.message, GENERATION_CANCEL_REASONS.userStop)
assert.deepEqual(
  resolveGenerationTerminalOutcome({
    signal: cancelled.session.abortController.signal,
    pipelineAborted: false,
    sdkOutcome: { status: "failed", error: new Error("provider abort") },
    thrown: new Error("provider surfaced cancellation as an error"),
    protocolError: new Error("abort chunk was not produced"),
    finishReason: "error",
  }),
  { status: "stopped", failed: false },
  "应用取消必须优先于 SDK / Provider 错误形态"
)
assert.deepEqual(
  resolveGenerationTerminalOutcome({
    signal: new AbortController().signal,
    pipelineAborted: false,
    sdkOutcome: { status: "completed" },
    thrown: null,
    protocolError: new Error("recoverable UI chunk error"),
    finishReason: "stop",
  }),
  { status: "completed", failed: false },
  "SDK 已完成时，可恢复 UI chunk error 不得把完整回复降级为 failed"
)
assert.equal(errors.length, 1, "预期取消不得进入 Session task error")

const discarded = store.start({
  messageId: "assistant-discarded",
  initialSnapshot: initialAssistantSnapshot({
    messageId: "assistant-discarded",
    threadId: "thread",
  }),
  run: async () => new Promise(() => {}),
})
const discardedEvents = []
store.subscribe(discarded.session.messageId, (event) =>
  discardedEvents.push(event)
)
assert.equal(
  store.discard(
    discarded.session.messageId,
    terminalMessage(discarded.session.messageId, "failed")
  ),
  true
)
assert.equal(store.get(discarded.session.messageId), null)
assert.equal(discardedEvents.at(-1).type, "terminal")

let checkpointNow = 100
const checkpointWrites = []
const checkpointer = new MessageCheckpointer(
  "checkpoint-message",
  async (_messageId, parts) => {
    checkpointWrites.push(structuredClone(parts))
    return true
  },
  20,
  () => checkpointNow
)
const checkpointBase = initialAssistantSnapshot({
  messageId: "checkpoint-message",
  threadId: "thread",
})
checkpointer.schedule({
  ...checkpointBase,
  parts: [{ type: "text", text: "a", state: "streaming" }],
})
checkpointer.schedule({
  ...checkpointBase,
  parts: [{ type: "text", text: "ab", state: "streaming" }],
})
await new Promise((resolve) => setTimeout(resolve, 5))
assert.equal(checkpointWrites.length, 1, "同一窗口只写最后一个快照")
assert.equal(checkpointWrites[0][0].text, "ab")
checkpointNow += 5
checkpointer.schedule({
  ...checkpointBase,
  parts: [{ type: "text", text: "abc", state: "streaming" }],
})
await new Promise((resolve) => setTimeout(resolve, 5))
assert.equal(checkpointWrites.length, 1, "节流窗口内不得立即重复写 DB")
checkpointNow += 20
await new Promise((resolve) => setTimeout(resolve, 20))
assert.equal(checkpointWrites.length, 2)
checkpointer.schedule({
  ...checkpointBase,
  parts: [{ type: "text", text: "abc", state: "streaming" }],
})
await checkpointer.flush()
assert.equal(checkpointWrites.length, 2, "无变化快照必须跳过")
checkpointer.stop()

store.dispose()
console.log("normalized StreamSession tests passed")
