import assert from "node:assert/strict"
import { createAssistantDeltaBuffer } from "../../app/thread-chat/net/stream/assistant-delta-buffer.ts"

function harness() {
  const calls = []
  let owner = true
  const buffer = createAssistantDeltaBuffer({
    store: {
      appendAssistantDelta(threadId, messageId, delta) {
        calls.push(["text", threadId, messageId, delta])
      },
      setMarkdownGenerationProgress(threadId, messageId, progress) {
        calls.push(["markdown", threadId, messageId, progress])
      },
    },
    threadId: "main",
    messageId: "a1",
    isOwner: () => owner,
  })
  return { calls, buffer, loseOwnership: () => (owner = false) }
}

const merged = harness()
merged.buffer.appendText("hello")
merged.buffer.appendText(" world")
merged.buffer.setMarkdownProgress({
  phase: "streaming",
  toolCallId: "tool-1",
  title: "Doc",
  receivedChars: 12,
})
assert.deepEqual(merged.calls, [])
merged.buffer.cancel()
merged.buffer.flush()
assert.deepEqual(merged.calls, [
  ["text", "main", "a1", "hello world"],
  [
    "markdown",
    "main",
    "a1",
    {
      phase: "streaming",
      toolCallId: "tool-1",
      title: "Doc",
      receivedChars: 12,
    },
  ],
])

const starting = harness()
const startProgress = {
  phase: "starting",
  toolCallId: "tool-2",
  title: "Doc",
  receivedChars: 0,
}
starting.buffer.setMarkdownProgress(startProgress)
assert.deepEqual(starting.calls, [["markdown", "main", "a1", startProgress]])

const stale = harness()
stale.buffer.appendText("stale")
stale.buffer.setMarkdownProgress({
  phase: "streaming",
  toolCallId: "tool-3",
  title: "Old",
  receivedChars: 5,
})
stale.loseOwnership()
stale.buffer.cancel()
stale.buffer.flush()
assert.deepEqual(stale.calls, [])
stale.buffer.flush()
assert.deepEqual(stale.calls, [])

const cleared = harness()
cleared.buffer.setMarkdownProgress({
  phase: "streaming",
  toolCallId: "tool-4",
  title: "Cleared",
  receivedChars: 3,
})
cleared.buffer.clearMarkdownProgress()
cleared.buffer.cancel()
cleared.buffer.flush()
assert.deepEqual(cleared.calls, [])

console.log(
  "PASS  assistant delta buffer merges text/progress, flushes starting state, and drops stale ownership"
)
