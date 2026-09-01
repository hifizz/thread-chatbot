import assert from "node:assert/strict"
import {
  buildPromptCacheObservabilityMetadata,
  PROMPT_CACHE_OBSERVABILITY_KEYS,
} from "../../lib/observability/prompt-cache.ts"

const manifest = {
  promptCompilerVersion: "compiler-v1",
  agentKernelVersion: "kernel-v1",
  quoteProtocolVersion: "quote-v1",
  quoteModelFormatVersion: "quote-model-v1",
  quoteBudgetPolicyVersion: "budget-v1",
  promptCacheProfileVersion: "cache-v1",
  toolProfileVersion: "tools-v1",
  cacheMode: "observe",
  ttlClass: "5m",
  extendedTtlEnabled: false,
  toolProfileId: "thread-answer-v1",
  toolProfileHash: "tool-hash",
  routeId: "fake:claude",
  forkContextHash: "fork-hash",
  stableRequestPrefixHash: "prefix-hash",
  fullRequestShapeHash: "full-hash",
  stablePrefixCharacters: 12000,
  stablePrefixTokenEstimate: 4000,
  currentUserQuoteCount: 2,
  segments: [],
  candidateBoundaries: [],
  cacheEligibility: { eligible: true, reason: "eligible" },
}
const metadata = buildPromptCacheObservabilityMetadata({
  manifest,
  cacheSummary: {
    inputTokens: 5000,
    cacheReadTokens: 4000,
    cacheWriteTokens: 0,
    cacheReadRatio: 0.8,
    providerHitCount: 1,
    quoteText: "secret quote body",
    prompt: "secret prompt",
    sourceMessageId: "secret-message-id",
  },
  cacheFallbackUsed: false,
  modelAttemptCount: 1,
})
for (const key of Object.keys(metadata)) {
  assert.ok(PROMPT_CACHE_OBSERVABILITY_KEYS.includes(key))
}
const serialized = JSON.stringify(metadata)
for (const forbidden of [
  "secret quote body",
  "secret prompt",
  "secret-message-id",
  "full-hash",
]) {
  assert.equal(serialized.includes(forbidden), false)
}
assert.equal(metadata.stablePrefixHash, "prefix-hash")
assert.equal(metadata.cacheReadTokens, 4000)
assert.equal(metadata.currentUserQuoteCount, 2)

console.log("prompt-cache metadata tests passed")
