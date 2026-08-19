import assert from "node:assert/strict"
import { GENERATION_RESULT_VERSION } from "../../constants/generation.ts"
import { generationResultV1Schema } from "../../lib/thread-chat/contracts/generation-result.ts"

const valid = {
  version: GENERATION_RESULT_VERSION,
  generationId: "generation-1",
  text: "answer",
  status: "done",
  artifactIds: ["artifact-1"],
  artifacts: {
    "artifact-1": {
      id: "artifact-1",
      title: "Report",
      kind: "markdown",
      content: "# Report",
      sourceThreadId: "main",
      sourceMessageId: "assistant-1",
    },
  },
  webResearch: [
    {
      toolCallId: "call-1",
      kind: "search",
      status: "complete",
      query: "source",
      sources: [{ title: "Primary", url: "https://example.com" }],
    },
  ],
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
}

assert.deepEqual(generationResultV1Schema.parse(valid), valid)

for (const invalid of [
  { ...valid, version: 2 },
  { ...valid, generationId: 1 },
  { ...valid, status: "complete" },
  {
    ...valid,
    artifacts: {
      "artifact-1": { ...valid.artifacts["artifact-1"], kind: "pdf" },
    },
  },
  { ...valid, webResearch: [{ ...valid.webResearch[0], status: "failed" }] },
]) {
  assert.equal(generationResultV1Schema.safeParse(invalid).success, false)
}

console.log(
  "PASS  generation result V1 schema validates version, artifacts, research activity, and usage"
)
