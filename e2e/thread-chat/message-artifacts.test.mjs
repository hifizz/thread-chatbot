import assert from "node:assert/strict"
import { selectMessageArtifacts } from "../../app/thread-chat/orchestration/artifacts/message-artifacts-logic.ts"

const first = { id: "artifact-1", sourceThreadId: "main" }
const second = { id: "artifact-2", sourceThreadId: "branch-1" }
const state = {
  artifacts: {
    "artifact-1": first,
    "artifact-2": second,
  },
}

assert.deepEqual(
  selectMessageArtifacts(state, {
    artifactIds: ["artifact-2", "missing", "artifact-1"],
  }),
  [second, first]
)
assert.deepEqual(
  selectMessageArtifacts(undefined, { artifactIds: ["artifact-1"] }),
  []
)
assert.deepEqual(selectMessageArtifacts(state, {}), [])

console.log(
  "PASS  message artifacts preserve message order and skip missing/unavailable records"
)
