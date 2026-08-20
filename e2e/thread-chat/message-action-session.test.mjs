import assert from "node:assert/strict"
import {
  indexMessageFeedbacks,
  indexRecoverableTurns,
  withMessageFeedback,
  withoutRecoverableTurn,
} from "../../app/thread-chat/chat/actions/message-action-session-logic.ts"

const recoverableTurn = {
  userMessageId: "user-1",
  generationId: "generation-1",
}
const recoverable = indexRecoverableTurns([recoverableTurn])
const without = withoutRecoverableTurn(recoverable, "user-1")
assert.equal(recoverable.get("user-1"), recoverableTurn)
assert.equal(without.has("user-1"), false)
assert.notEqual(without, recoverable)

const feedback = indexMessageFeedbacks([
  { messageId: "assistant-1", feedback: "positive" },
])
const changed = withMessageFeedback(feedback, "assistant-1", "negative")
const removed = withMessageFeedback(changed, "assistant-1", null)
assert.equal(feedback.get("assistant-1"), "positive")
assert.equal(changed.get("assistant-1"), "negative")
assert.equal(removed.has("assistant-1"), false)
assert.notEqual(changed, feedback)
assert.notEqual(removed, changed)

console.log(
  "PASS  message action session indexes and updates recoverable/feedback maps immutably"
)
