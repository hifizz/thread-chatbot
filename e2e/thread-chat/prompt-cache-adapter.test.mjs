import assert from "node:assert/strict"
import { buildPromptCacheAdapterPlan } from "../../lib/ai/prompt-cache-adapter.ts"

const candidates = [
  { kind: "kernel-end", tokenEstimate: 1200 },
  { kind: "inherited-end", tokenEstimate: 6000 },
  { kind: "branch-history-end", tokenEstimate: 7000 },
]

const explicit = buildPromptCacheAdapterPlan({
  strategy: "explicit-breakpoint",
  candidates,
  minimumPrefixTokens: 1000,
  maximumBreakpoints: 2,
  ttlClass: "5m",
})
assert.equal(explicit.enabled, true)
assert.deepEqual(
  explicit.markers.map((marker) => marker.boundary),
  ["inherited-end", "branch-history-end"]
)
assert.deepEqual(explicit.markers[0].providerOptions, {
  anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } },
})

const belowMinimum = buildPromptCacheAdapterPlan({
  strategy: "explicit-breakpoint",
  candidates: [{ kind: "inherited-end", tokenEstimate: 999 }],
  minimumPrefixTokens: 1000,
  maximumBreakpoints: 1,
  ttlClass: "provider-default",
})
assert.equal(belowMinimum.enabled, false)
assert.equal(belowMinimum.reason, "below-minimum")

assert.deepEqual(
  buildPromptCacheAdapterPlan({
    strategy: "gateway-auto",
    candidates,
    minimumPrefixTokens: 1000,
    ttlClass: "5m",
  }).providerOptions,
  { gateway: { caching: "auto" } }
)
assert.equal(
  buildPromptCacheAdapterPlan({
    strategy: "implicit",
    candidates,
    minimumPrefixTokens: 1000,
    ttlClass: "5m",
  }).markers.length,
  0
)
assert.equal(
  buildPromptCacheAdapterPlan({
    strategy: "probe-required",
    candidates,
    minimumPrefixTokens: 1000,
    ttlClass: "5m",
  }).enabled,
  false
)

console.log("PASS fake provider cache adapter plans")
