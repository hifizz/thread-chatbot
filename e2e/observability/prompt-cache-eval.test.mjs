import assert from "node:assert/strict"
import {
  fakeClaudeCacheFixture,
  promptCacheCandidateFingerprint,
  scorePromptCacheFixture,
} from "../../evals/agent/prompt-cache.ts"

const report = fakeClaudeCacheFixture()
assert.equal(report.reuse.providerHit, true)
assert.ok(report.reuse.usage.cacheReadTokens > 0)
assert.ok(report.netSavings > 0)
assert.equal(report.enableRecommended, true)

const regression = fakeClaudeCacheFixture({ qualityGatePassed: false })
assert.equal(regression.enableRecommended, false)

const scores = scorePromptCacheFixture({
  stablePrefixHashLeft: "shared",
  stablePrefixHashRight: "shared",
  fullShapeHashLeft: "branch-b",
  fullShapeHashRight: "branch-c",
  quoteCount: 50,
  modelText: "only quote text and comment",
  forbiddenMetadata: ["thread-id", "message-id", "trace-id"],
  cacheReadTokens: report.reuse.usage.cacheReadTokens,
  totalCost: report.reuse.totalCost,
  netSavings: report.netSavings,
  qualityGatePassed: true,
})
assert.ok(scores.every((score) => score.passed !== false))

const blockedScores = scorePromptCacheFixture({
  stablePrefixHashLeft: "shared",
  stablePrefixHashRight: "shared",
  fullShapeHashLeft: "branch-b",
  fullShapeHashRight: "branch-c",
  quoteCount: 1,
  modelText: "thread-id leaked",
  forbiddenMetadata: ["thread-id"],
  netSavings: 1,
  qualityGatePassed: false,
})
assert.equal(
  blockedScores.find((score) => score.name === "prompt-cache-metadata-excluded")
    ?.passed,
  false
)
assert.equal(
  blockedScores.find((score) => score.name === "prompt-cache-quality-gate")
    ?.passed,
  false
)

const fingerprint = promptCacheCandidateFingerprint({
  candidate: "prompt-cache-v1",
  promptCompilerVersion: "compiler-v1",
  agentKernelVersion: "kernel-v1",
  quoteProtocolVersion: "quote-v1",
  quoteModelFormatVersion: "quote-model-v1",
  quoteBudgetPolicyVersion: "budget-v1",
  toolProfileId: "thread-answer-v1",
  routeId: "fake:umapis-claude",
  routingPolicyVersion: "routing-v1",
  cacheProfileVersion: "cache-v1",
})
assert.equal(fingerprint.length, 64)
assert.equal(
  fingerprint,
  promptCacheCandidateFingerprint({
    candidate: "prompt-cache-v1",
    promptCompilerVersion: "compiler-v1",
    agentKernelVersion: "kernel-v1",
    quoteProtocolVersion: "quote-v1",
    quoteModelFormatVersion: "quote-model-v1",
    quoteBudgetPolicyVersion: "budget-v1",
    toolProfileId: "thread-answer-v1",
    routeId: "fake:umapis-claude",
    routingPolicyVersion: "routing-v1",
    cacheProfileVersion: "cache-v1",
  })
)

console.log("prompt-cache eval tests passed")
