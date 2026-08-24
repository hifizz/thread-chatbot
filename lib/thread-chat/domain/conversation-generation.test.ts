import assert from "node:assert/strict"
import test from "node:test"

import {
  aggregateKnownUsage,
  checkpointMessageContent,
  conversationGenerationCheckpointSchema,
  hasRecoverableCheckpointOutput,
  inferUsageCompleteness,
  terminalMessageContentState,
} from "./conversation-generation.ts"

test("checkpoint 保留正文、Artifact、研究活动及 running 状态", () => {
  const checkpoint = conversationGenerationCheckpointSchema.parse({
    schemaVersion: 1,
    body: "阶段结论",
    artifactIds: ["artifact-1"],
    researchPlan: { query: "第一性原理" },
    researchActivities: [
      {
        id: "search-1",
        kind: "search",
        status: "running",
        sources: [{ url: "https://example.invalid/source" }],
      },
    ],
    contentState: "streaming",
    knownUsage: null,
  })

  assert.equal(hasRecoverableCheckpointOutput(checkpoint), true)
  assert.equal(checkpoint.researchActivities[0]?.status, "running")
  assert.deepEqual(
    checkpointMessageContent(checkpoint).parts.map((part) => part.type),
    ["text", "artifact-reference", "structured", "structured"]
  )
  assert.equal(
    terminalMessageContentState({ outcome: "stopped", checkpoint }),
    "incomplete"
  )
})

test("无输出失败和有输出失败具有不同 Message 内容状态", () => {
  const empty = conversationGenerationCheckpointSchema.parse({
    schemaVersion: 1,
    body: "",
    artifactIds: [],
    researchPlan: null,
    researchActivities: [],
    contentState: "pending",
    knownUsage: null,
  })
  assert.equal(
    terminalMessageContentState({ outcome: "failed", checkpoint: empty }),
    "failed"
  )
  assert.equal(
    terminalMessageContentState({
      outcome: "failed",
      checkpoint: { ...empty, body: "可恢复部分" },
    }),
    "incomplete"
  )
})

test("usage 聚合不把部分或未知值伪装为完整", () => {
  assert.deepEqual(
    aggregateKnownUsage([
      { paid: true, inputTokens: 10, outputTokens: 5 },
      { paid: true },
    ]),
    {
      knownUsage: {
        inputTokens: 10,
        outputTokens: 5,
        paidStepCount: 2,
        reportedStepCount: 1,
      },
      completeness: "partial",
    }
  )
  assert.deepEqual(aggregateKnownUsage([{ paid: true }]), {
    knownUsage: null,
    completeness: "unavailable",
  })
  assert.equal(
    aggregateKnownUsage([
      { paid: true, inputTokens: 2, outputTokens: 3 },
      { paid: true, inputTokens: 5, outputTokens: 7 },
    ]).completeness,
    "complete"
  )
  assert.equal(
    inferUsageCompleteness({
      inputTokens: 1,
      outputTokens: 2,
      paidStepCount: 2,
      reportedStepCount: 1,
    }),
    "partial"
  )
})
