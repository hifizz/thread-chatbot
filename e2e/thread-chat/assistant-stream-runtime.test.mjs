import assert from "node:assert/strict"
import { createAssistantStreamRuntime } from "../../app/thread-chat/net/assistant-stream-runtime.ts"

function harness({ owner = true, artifactId = "artifact-1" } = {}) {
  const calls = []
  const store = {
    appendAssistantDelta(threadId, messageId, delta) {
      calls.push(["text", threadId, messageId, delta])
    },
    setMarkdownGenerationProgress(threadId, messageId, progress) {
      calls.push(["markdown-progress", threadId, messageId, progress])
    },
    attachArtifactToMessage(threadId, messageId, seed) {
      calls.push(["artifact", threadId, messageId, seed])
      return artifactId
    },
    setWebResearchActivity(threadId, messageId, activity) {
      calls.push(["research", threadId, messageId, activity])
    },
    setResearchRoute(threadId, messageId, route) {
      calls.push(["route", threadId, messageId, route])
    },
    setResearchPlan(threadId, messageId, plan) {
      calls.push(["plan", threadId, messageId, plan])
    },
    finishAssistantMessage(threadId, messageId) {
      calls.push(["finish", threadId, messageId])
    },
    failAssistantMessage(threadId, messageId, message) {
      calls.push(["fail", threadId, messageId, message])
    },
  }
  return {
    calls,
    runtime: createAssistantStreamRuntime({
      store,
      threadId: "main",
      messageId: "a1",
      isOwner: () => owner,
    }),
  }
}

const originalWarn = console.warn
const warnings = []
console.warn = (...args) => warnings.push(args)
try {
  const transient = harness()
  transient.runtime.handlers.onTextDelta("hello")
  transient.runtime.handlers.onError("transient")
  transient.runtime.handlers.onFinish()
  assert.deepEqual(transient.calls, [
    ["text", "main", "a1", "hello"],
    ["finish", "main", "a1"],
  ])
  assert.equal(warnings.length, 1)

  const streamError = harness()
  streamError.runtime.handlers.onError("upstream failed")
  streamError.runtime.settleByOutcome()
  assert.deepEqual(streamError.calls, [
    ["fail", "main", "a1", "upstream failed"],
  ])

  const empty = harness()
  empty.runtime.settleByOutcome()
  assert.deepEqual(empty.calls, [
    ["fail", "main", "a1", "未收到任何回复，请重试"],
  ])

  const aborted = harness()
  aborted.runtime.handlers.onTextDelta("partial")
  aborted.runtime.settleByAbort()
  assert.deepEqual(aborted.calls, [
    ["text", "main", "a1", "partial"],
    ["fail", "main", "a1", "已停止生成"],
  ])

  const artifact = harness()
  artifact.runtime.handlers.onMarkdownArtifact({
    toolCallId: "tool-1",
    input: { title: "Doc", content: "# body" },
  })
  artifact.runtime.settleByOutcome()
  assert.deepEqual(artifact.calls, [
    [
      "artifact",
      "main",
      "a1",
      { kind: "markdown", title: "Doc", content: "# body" },
    ],
    ["finish", "main", "a1"],
  ])

  const research = harness()
  research.runtime.handlers.onTextDelta("before")
  research.runtime.handlers.onWebResearchActivity({
    toolCallId: "search-1",
    kind: "search",
    status: "running",
  })
  assert.deepEqual(
    research.calls.map((call) => call[0]),
    ["text", "research"]
  )
  research.runtime.fail("manual failure")
  assert.equal(research.calls.at(-1)[0], "fail")

  const stale = harness({ owner: false })
  stale.runtime.handlers.onTextDelta("stale")
  stale.runtime.handlers.onResearchRoute({ mode: "answer" })
  stale.runtime.settleByOutcome()
  assert.deepEqual(stale.calls, [])

  const idempotent = harness()
  idempotent.runtime.settleByAbort()
  idempotent.runtime.settleByOutcome()
  idempotent.runtime.fail("late")
  assert.deepEqual(idempotent.calls, [["fail", "main", "a1", "已停止生成"]])
} finally {
  console.warn = originalWarn
}

console.log(
  "PASS  assistant stream runtime composes buffering, output evidence, SSE projection, ownership, and one-shot settlement"
)
