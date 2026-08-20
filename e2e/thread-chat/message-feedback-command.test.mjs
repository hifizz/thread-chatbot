import assert from "node:assert/strict"
import { submitMessageFeedback } from "../../app/thread-chat/net/commands/message-feedback-command.ts"

const treeId = "11111111-1111-4111-8111-111111111111"
const messageId = "message/with space"
let request
const feedback = await submitMessageFeedback(
  { treeId, threadId: "main", messageId, feedback: "negative" },
  {
    async fetch(input, init) {
      request = { input, init }
      return Response.json({
        feedback: {
          treeId,
          threadId: "main",
          messageId,
          feedback: "negative",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      })
    },
  }
)
assert.equal(
  request.input,
  `/api/branch-trees/${treeId}/messages/message%2Fwith%20space/feedback`
)
assert.equal(request.init.method, "PUT")
assert.deepEqual(JSON.parse(request.init.body), {
  threadId: "main",
  feedback: "negative",
})
assert.equal(feedback.feedback, "negative")

const cleared = await submitMessageFeedback(
  { treeId, threadId: "main", messageId: "a1", feedback: null },
  { fetch: async () => Response.json({ feedback: null }) }
)
assert.equal(cleared, null)

await assert.rejects(
  () =>
    submitMessageFeedback(
      { treeId, threadId: "main", messageId: "a1", feedback: "positive" },
      {
        fetch: async () =>
          Response.json(
            {
              error: {
                code: "message_not_completed",
                message: "只有已完成的 AI 回复可以评价",
              },
            },
            { status: 409 }
          ),
      }
    ),
  /只有已完成的 AI 回复可以评价/
)

await assert.rejects(
  () =>
    submitMessageFeedback(
      { treeId, threadId: "main", messageId: "a1", feedback: "positive" },
      { fetch: async () => Response.json({ unexpected: true }) }
    ),
  /feedback response invalid/
)

await assert.rejects(
  () =>
    submitMessageFeedback(
      { treeId, threadId: "main", messageId: "a1", feedback: "positive" },
      { fetch: async () => new Response("bad gateway", { status: 502 }) }
    ),
  /feedback failed: 502/
)

console.log(
  "PASS  message feedback command owns URL, request body, shared response contracts, and fallback errors"
)
