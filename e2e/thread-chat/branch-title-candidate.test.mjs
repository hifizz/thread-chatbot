import assert from "node:assert/strict"
import { branchTitleCandidate } from "../../app/thread-chat/net/titles/branch-title-candidate.ts"
import { defaultBranchTitle } from "../../app/thread-chat/core/store.ts"

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
const state = { threads: { child }, artifacts: {} }

assert.deepEqual(branchTitleCandidate(state, child), {
  threadId: "child",
  input: {
    anchorText,
    question: "follow up",
    answer: "complete answer",
  },
})
assert.equal(branchTitleCandidate(state, { ...child, parentId: null }), null)
assert.equal(branchTitleCandidate(state, { ...child, title: "renamed" }), null)
assert.equal(
  branchTitleCandidate(state, {
    ...child,
    messages: child.messages.map((message) =>
      message.role === "assistant"
        ? { ...message, status: "streaming" }
        : message
    ),
  }),
  null
)

console.log(
  "PASS  branch title candidate requires a default-titled child and a completed renderable first turn"
)
