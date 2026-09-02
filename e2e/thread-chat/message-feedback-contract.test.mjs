import assert from "node:assert/strict"
import {
  MESSAGE_FEEDBACK_HTTP_ERRORS,
  messageFeedbackSchema,
  setMessageFeedbackErrorResponseSchema,
  setMessageFeedbackFailureReasonSchema,
  setMessageFeedbackRequestSchema,
  setMessageFeedbackSuccessResponseSchema,
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

for (const reason of ["not_found", "not_completed", "missing_generation"]) {
  assert.equal(
    setMessageFeedbackFailureReasonSchema.safeParse(reason).success,
    true
  )
  const definition = MESSAGE_FEEDBACK_HTTP_ERRORS[reason]
  assert.equal(
    setMessageFeedbackErrorResponseSchema.safeParse({
      error: definition.error,
    }).success,
    true
  )
}

const summary = {
  treeId: "tree-1",
  threadId: "main",
  messageId: "assistant-1",
  feedback: "positive",
  updatedAt: "2026-08-20T00:00:00.000Z",
}
assert.equal(
  setMessageFeedbackSuccessResponseSchema.safeParse({ feedback: summary })
    .success,
  true
)
assert.equal(
  setMessageFeedbackSuccessResponseSchema.safeParse({ feedback: null }).success,
  true
)
assert.equal(
  setMessageFeedbackSuccessResponseSchema.safeParse({ feedback: "positive" })
    .success,
  false
)

console.log(
  "PASS  message feedback contract owns request, repository failure, and HTTP response shapes"
)
