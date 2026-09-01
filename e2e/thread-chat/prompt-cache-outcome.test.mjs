import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyPromptCacheOutcome,
  selectPromptCacheBreakpoints,
} from "../../lib/thread-chat/prompt-cache/provider-controls.ts"

const boundaries = [
  {
    kind: "kernel-end",
    prefixHash: "kernel",
    characters: 3_000,
    tokenEstimate: 1_000,
  },
  {
    kind: "inherited-end",
    prefixHash: "inherited",
    characters: 9_000,
    tokenEstimate: 3_000,
  },
  {
    kind: "branch-history-end",
    prefixHash: "branch",
    characters: 12_000,
    tokenEstimate: 4_000,
  },
]

test("explicit breakpoints prioritize inherited, branch history, then kernel", () => {
  assert.deepEqual(
    selectPromptCacheBreakpoints({
      boundaries,
      strategy: "explicit-breakpoint",
      minimumPrefixTokens: 500,
      maxBreakpoints: 3,
    }),
    ["inherited-end", "branch-history-end", "kernel-end"]
  )
  assert.deepEqual(
    selectPromptCacheBreakpoints({
      boundaries,
      strategy: "explicit-breakpoint",
      minimumPrefixTokens: 2_000,
      maxBreakpoints: 1,
    }),
    ["inherited-end"]
  )
})

test("implicit and gateway caching do not invent explicit markers", () => {
  for (const strategy of ["implicit", "gateway-auto", "probe-required"]) {
    assert.deepEqual(
      selectPromptCacheBreakpoints({ boundaries, strategy }),
      []
    )
  }
})

test("cache outcomes distinguish architecture eligibility from provider evidence", () => {
  assert.equal(
    classifyPromptCacheOutcome({ eligible: false }),
    "ineligible"
  )
  assert.equal(
    classifyPromptCacheOutcome({
      eligible: true,
      samePrefixPreviouslySubmitted: false,
      latestAssistantWasPreviouslyInput: false,
    }),
    "partial-warm"
  )
  assert.equal(
    classifyPromptCacheOutcome({
      eligible: true,
      samePrefixPreviouslySubmitted: false,
      latestAssistantWasPreviouslyInput: true,
    }),
    "cold-start"
  )
  assert.equal(
    classifyPromptCacheOutcome({
      eligible: true,
      samePrefixPreviouslySubmitted: true,
      usage: {
        attemptCount: 1,
        providerHit: true,
        cacheReadTokens: 100,
        source: "provider-metadata",
        complete: true,
      },
    }),
    "provider-hit"
  )
  assert.equal(
    classifyPromptCacheOutcome({
      eligible: true,
      samePrefixPreviouslySubmitted: true,
      usage: {
        attemptCount: 1,
        providerHit: null,
        source: "unavailable",
        complete: false,
      },
    }),
    "usage-unavailable"
  )
  assert.equal(
    classifyPromptCacheOutcome({ eligible: true, routeDrift: true }),
    "route-drift"
  )
  assert.equal(
    classifyPromptCacheOutcome({ eligible: true, ttlExpired: true }),
    "ttl-expired"
  )
})
