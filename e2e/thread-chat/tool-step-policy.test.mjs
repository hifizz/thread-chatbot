import assert from "node:assert/strict"
import { createToolStepPolicy } from "../../app/api/chat/tool-step-policy.ts"
import { researchToolNames } from "../../app/api/chat/research-tool-capabilities.ts"

assert.deepEqual(researchToolNames("answer"), [])
assert.deepEqual(researchToolNames("fetch"), ["readUrl"])
assert.deepEqual(researchToolNames("search"), ["webSearch", "readUrl"])
assert.deepEqual(researchToolNames("research"), ["webSearch", "readUrl"])

assert.equal(
  createToolStepPolicy({
    isThreadChat: false,
    markdownArtifactRequested: false,
    researchMode: "answer",
  }),
  undefined
)

const fetchPolicy = createToolStepPolicy({
  isThreadChat: true,
  markdownArtifactRequested: true,
  researchMode: "fetch",
})
assert.deepEqual(fetchPolicy?.({ stepNumber: 0 }), {
  activeTools: ["createMarkdownArtifact", "readUrl"],
  toolChoice: { type: "tool", toolName: "readUrl" },
})
assert.deepEqual(fetchPolicy?.({ stepNumber: 1 }), {
  activeTools: ["createMarkdownArtifact", "readUrl"],
})

for (const researchMode of ["search", "research"]) {
  const policy = createToolStepPolicy({
    isThreadChat: false,
    markdownArtifactRequested: false,
    researchMode,
  })
  assert.deepEqual(policy?.({ stepNumber: 0 }), {
    activeTools: ["webSearch", "readUrl"],
    toolChoice: { type: "tool", toolName: "webSearch" },
  })
  assert.deepEqual(policy?.({ stepNumber: 2 }), {
    activeTools: ["webSearch", "readUrl"],
  })
}

const markdownPolicy = createToolStepPolicy({
  isThreadChat: true,
  markdownArtifactRequested: true,
  researchMode: "answer",
})
assert.deepEqual(markdownPolicy?.({ stepNumber: 0 }), {
  activeTools: ["createMarkdownArtifact"],
  toolChoice: { type: "tool", toolName: "createMarkdownArtifact" },
})
assert.deepEqual(markdownPolicy?.({ stepNumber: 1 }), {
  activeTools: ["createMarkdownArtifact"],
})

console.log(
  "PASS  chat tool step policy preserves route priority and later-step availability"
)
