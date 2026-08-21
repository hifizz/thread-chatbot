import assert from "node:assert/strict"
import { threadTitleCandidate } from "../../app/thread-chat/net/titles/thread-title-candidate.ts"
import { defaultBranchTitle } from "../../app/thread-chat/core/store.ts"
import { requestThreadTitle } from "../../app/thread-chat/net/titles/thread-title.ts"
import { parseThreadTitleInput } from "../../lib/thread-chat/contracts/title-request.ts"

const anchorText = "a sufficiently long selected passage"
const child = {
  id: "child",
  parentId: "main",
  anchorText,
  title: defaultBranchTitle(anchorText),
  messages: [
    { id: "user-1", role: "user", text: "follow up", forks: [] },
    {
      id: "assistant-1",
      role: "assistant",
      status: "done",
      text: "complete answer",
      forks: [],
    },
  ],
}
const main = {
  id: "main",
  parentId: null,
  title: "",
  messages: [
    { id: "main-user-1", role: "user", text: "explain consistency", forks: [] },
  ],
}
const state = { threads: { main, child }, artifacts: {} }

assert.deepEqual(threadTitleCandidate(state, main), {
  threadId: "main",
  input: {
    kind: "main",
    question: "explain consistency",
  },
})
assert.deepEqual(threadTitleCandidate(state, child), {
  threadId: "child",
  input: {
    kind: "branch",
    anchorText,
    question: "follow up",
    answer: "complete answer",
  },
})
assert.equal(
  threadTitleCandidate(state, { ...main, titleGenerationAttempted: true }),
  null
)
assert.equal(threadTitleCandidate(state, { ...child, parentId: null }), null)
assert.equal(threadTitleCandidate(state, { ...child, title: "renamed" }), null)
assert.equal(
  threadTitleCandidate(state, {
    ...child,
    messages: child.messages.map((message) =>
      message.role === "assistant"
        ? { ...message, status: "streaming" }
        : message
    ),
  }),
  null
)

const originalFetch = globalThis.fetch
let capturedRequest = null
try {
  globalThis.fetch = async (input, init) => {
    capturedRequest = { input, init }
    return Response.json({ title: "  Unified title  " })
  }
  assert.equal(
    await requestThreadTitle({ kind: "main", question: "hello" }),
    "Unified title"
  )
} finally {
  globalThis.fetch = originalFetch
}

assert.equal(capturedRequest.input, "/api/title")
assert.equal(capturedRequest.init.method, "POST")
assert.deepEqual(JSON.parse(capturedRequest.init.body), {
  kind: "main",
  question: "hello",
})
assert.equal(
  parseThreadTitleInput({
    anchorText,
    question: "legacy request",
    answer: "missing explicit kind",
  }),
  null
)
assert.deepEqual(
  parseThreadTitleInput({
    kind: "branch",
    anchorText,
    question: "explicit request",
    answer: "accepted",
  }),
  {
    kind: "branch",
    anchorText,
    question: "explicit request",
    answer: "accepted",
  }
)

console.log(
  "PASS  thread title candidates and client request share the unified explicit title contract"
)
