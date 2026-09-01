import assert from "node:assert/strict"
import { PromptCacheWarmthTracker } from "../../lib/ai/prompt-cache-warmth.ts"

const tracker = new PromptCacheWarmthTracker()
const base = {
  stablePrefixHash: "prefix-a",
  routeId: "route-a",
  nowMs: 1_000,
  ttlMs: 300_000,
}

assert.equal(tracker.classify(base), "cold-start")
assert.equal(
  tracker.classify({ ...base, partialWarmHint: true }),
  "partial-warm"
)

tracker.markSubmitted({
  stablePrefixHash: base.stablePrefixHash,
  routeId: base.routeId,
  submittedAt: base.nowMs,
})
assert.equal(
  tracker.classify({ ...base, nowMs: 2_000 }),
  "warm-candidate"
)
assert.equal(
  tracker.classify({
    ...base,
    routeId: "route-b",
    nowMs: 2_000,
  }),
  "route-drift"
)
assert.equal(
  tracker.classify({
    ...base,
    nowMs: base.nowMs + base.ttlMs + 1,
  }),
  "ttl-expired"
)

tracker.clear()
assert.equal(tracker.classify(base), "cold-start")

console.log("prompt cache warmth tests passed")
