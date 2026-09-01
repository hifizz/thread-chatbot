import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizePromptCacheUsage,
  summarizeModelAttempts,
} from "../../lib/thread-chat/prompt-cache/usage.ts"

test("uses AI SDK cache details when available", () => {
  const usage = normalizePromptCacheUsage({
    usage: {
      inputTokens: 1_000,
      outputTokens: 100,
      totalTokens: 1_100,
      inputTokenDetails: {
        cacheReadTokens: 700,
        cacheWriteTokens: 100,
      },
    },
  })
  assert.deepEqual(usage, {
    inputTokens: 1_000,
    outputTokens: 100,
    totalTokens: 1_100,
    cacheReadTokens: 700,
    cacheWriteTokens: 100,
    uncachedInputTokens: 200,
    source: "ai-sdk-usage",
    complete: true,
  })
})

test("falls back to provider metadata for Claude/OpenRouter style fields", () => {
  const usage = normalizePromptCacheUsage({
    usage: { inputTokens: 900, outputTokens: 50 },
    providerMetadata: {
      openrouter: {
        usage: {
          cached_tokens: 600,
          cache_creation_input_tokens: 100,
          cost: 0.0123,
        },
      },
    },
  })
  assert.equal(usage.cacheReadTokens, 600)
  assert.equal(usage.cacheWriteTokens, 100)
  assert.equal(usage.uncachedInputTokens, 200)
  assert.equal(usage.costUsd, 0.0123)
  assert.equal(usage.source, "provider-metadata")
  assert.equal(usage.complete, true)
})

test("keeps absent cache evidence unknown instead of inventing zero", () => {
  const usage = normalizePromptCacheUsage({
    usage: { inputTokens: 100, outputTokens: 10 },
  })
  assert.equal(usage.inputTokens, 100)
  assert.equal(usage.cacheReadTokens, undefined)
  assert.equal(usage.cacheWriteTokens, undefined)
  assert.equal(usage.uncachedInputTokens, undefined)
  assert.equal(usage.complete, false)
})

test("standard usage wins over conflicting provider metadata", () => {
  const usage = normalizePromptCacheUsage({
    usage: {
      inputTokens: 100,
      inputTokenDetails: {
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
      },
    },
    providerMetadata: {
      provider: {
        cached_tokens: 90,
        cache_creation_input_tokens: 9,
      },
    },
  })
  assert.equal(usage.cacheReadTokens, 40)
  assert.equal(usage.cacheWriteTokens, 10)
  assert.equal(usage.uncachedInputTokens, 50)
  assert.equal(usage.source, "ai-sdk-usage")
})

test("aggregates all model attempts and preserves evidence availability", () => {
  const attempts = [
    {
      stepIndex: 0,
      purpose: "chat-answer",
      routeId: "route",
      upstreamModelId: "model",
      toolProfileId: "thread-web-v1",
      stableRequestPrefixHash: "hash",
      cacheStrategy: "implicit",
      cacheEligibility: "eligible",
      usage: normalizePromptCacheUsage({
        usage: {
          inputTokens: 1_000,
          outputTokens: 100,
          inputTokenDetails: {
            cacheReadTokens: 600,
            cacheWriteTokens: 100,
          },
        },
        providerMetadata: { usage: { cost: 0.01 } },
      }),
    },
    {
      stepIndex: 1,
      purpose: "chat-answer",
      routeId: "route",
      upstreamModelId: "model",
      toolProfileId: "thread-web-v1",
      stableRequestPrefixHash: "hash",
      cacheStrategy: "implicit",
      cacheEligibility: "eligible",
      usage: normalizePromptCacheUsage({
        usage: {
          inputTokens: 1_200,
          outputTokens: 120,
          inputTokenDetails: {
            cacheReadTokens: 900,
            cacheWriteTokens: 0,
          },
        },
        providerMetadata: { usage: { cost: 0.008 } },
      }),
    },
  ]
  const summary = summarizeModelAttempts(attempts)
  assert.equal(summary.attemptCount, 2)
  assert.equal(summary.inputTokens, 2_200)
  assert.equal(summary.cacheReadTokens, 1_500)
  assert.equal(summary.cacheWriteTokens, 100)
  assert.equal(summary.providerHit, true)
  assert.equal(summary.cacheReadRatio, 1_500 / 2_200)
  assert.equal(summary.costUsd, 0.018)
  assert.equal(summary.complete, true)
})

test("cyclic provider metadata cannot break a successful generation", () => {
  const cyclic = {}
  cyclic.self = cyclic
  const usage = normalizePromptCacheUsage({
    usage: { inputTokens: 10 },
    providerMetadata: cyclic,
  })
  assert.equal(usage.inputTokens, 10)
  assert.equal(usage.complete, false)
})
