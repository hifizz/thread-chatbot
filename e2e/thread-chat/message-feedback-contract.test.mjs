import assert from "node:assert/strict"
import {
  messageFeedbackSchema,
  setMessageFeedbackRequestSchema,
} from "../../lib/thread-chat/contracts/message-feedback.ts"

for (const feedback of ["positive", "negative"]) {
  assert.equal(messageFeedbackSchema.safeParse(feedback).success, true)
}

for (const body of [
  { threadId: "main", feedback: "positive" },
  { threadId: "branch-1", feedback: "negative" },
  { threadId: "main", feedback: null },
]) {
  assert.equal(setMessageFeedbackRequestSchema.safeParse(body).success, true)
}

for (const body of [
  { threadId: "", feedback: "positive" },
  { threadId: "main" },
  { threadId: "main", feedback: "neutral" },
  { threadId: "main", feedback: 1 },
  null,
]) {
  assert.equal(setMessageFeedbackRequestSchema.safeParse(body).success, false)
}

console.log(
  "PASS  message feedback contract accepts positive, negative, and clear requests while rejecting invalid identities and values"
)
