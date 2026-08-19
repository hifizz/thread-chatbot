import assert from "node:assert/strict"
import {
  SWITCH_ACTIVE_LEAF_ERROR_STATUS,
  switchActiveLeafErrorResponseSchema,
  switchActiveLeafFailureReasonSchema,
  switchActiveLeafRequestSchema,
  switchActiveLeafSuccessResponseSchema,
} from "../../lib/thread-chat/contracts/switch-active-leaf.ts"

const request = switchActiveLeafRequestSchema.parse({
  threadId: "  main  ",
  assistantMessageId: "  assistant-2  ",
  baseRevision: 3,
})
assert.deepEqual(request, {
  threadId: "main",
  assistantMessageId: "assistant-2",
  baseRevision: 3,
})

for (const invalid of [
  null,
  { threadId: "", assistantMessageId: "assistant-2", baseRevision: 3 },
  { threadId: "main", assistantMessageId: "", baseRevision: 3 },
  { threadId: "main", assistantMessageId: "assistant-2", baseRevision: -1 },
  { threadId: "main", assistantMessageId: "assistant-2", baseRevision: 1.5 },
]) {
  assert.equal(switchActiveLeafRequestSchema.safeParse(invalid).success, false)
}

for (const reason of ["not_found", "tree_revision_conflict", "invalid_turn"]) {
  assert.equal(
    switchActiveLeafFailureReasonSchema.safeParse(reason).success,
    true
  )
  assert.equal(typeof SWITCH_ACTIVE_LEAF_ERROR_STATUS[reason], "number")
}

assert.equal(
  switchActiveLeafSuccessResponseSchema.safeParse({
    revision: 4,
    thread: { id: "main", activeLeafMessageId: "assistant-2" },
  }).success,
  true
)
assert.equal(
  switchActiveLeafErrorResponseSchema.safeParse({
    error: {
      code: "tree_revision_conflict",
      message: "该对话已在其他页面更新",
      currentRevision: 4,
    },
  }).success,
  true
)

console.log(
  "PASS  switch active leaf contract owns request, revision, failure, and response shapes"
)
