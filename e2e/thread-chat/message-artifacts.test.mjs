import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

const [messageArtifacts, card, openContract] = await Promise.all([
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/artifacts/message-artifacts.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/artifacts/markdown-artifact-card.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/artifacts/artifact-open.ts",
      import.meta.url
    ),
    "utf8"
  ),
])
assert.match(messageArtifacts, /onOpen\?: OpenArtifact/)
assert.match(card, /source: event\.detail === 0 \? "keyboard" : "pointer"/)
assert.match(card, /getBoundingClientRect\(\)/)
assert.match(card, /serializeArtifactAnchorRect/)
assert.match(openContract, /source: "pointer" \| "keyboard" \| "topbar"/)
assert.match(openContract, /anchorRect\?: ArtifactAnchorRect/)
assert.match(openContract, /artifactId: string,[\s\S]*options: OpenArtifactOptions/)

console.log(
  "PASS  message artifacts preserve message order and skip missing/unavailable records"
)
