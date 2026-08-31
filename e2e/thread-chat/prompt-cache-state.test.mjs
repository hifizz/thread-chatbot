import assert from "node:assert/strict"
import { inferPromptCacheState } from "../../lib/ai/prompt-cache-state.ts"

const unavailable = { source: "unavailable", complete: false }

assert.equal(
  inferPromptCacheState({
    eligible: false,
    currentRouteId: "route-a",
    usage: unavailable,
  }).outcome,
  "below-minimum"
)
assert.equal(
  inferPromptCacheState({
    eligible: true,
    currentRouteId: "route-b",
    previousRouteId: "route-a",
    usage: unavailable,
  }).outcome,
  "route-drift"
)
assert.equal(
  inferPromptCacheState({
    eligible: true,
    currentRouteId: "route-a",
    usage: { cacheReadTokens: 1000, source: "ai-sdk-usage", complete: true },
  }).outcome,
  "provider-hit"
)
assert.equal(
  inferPromptCacheState({
    eligible: true,
    currentRouteId: "route-a",
    usage: { cacheReadTokens: 0, source: "ai-sdk-usage", complete: true },
  }).outcome,
  "provider-miss"
)
assert.equal(
  inferPromptCacheState({
    eligible: true,
    currentRouteId: "route-a",
    latestAssistantWasPreviouslyInput: false,
    usage: unavailable,
  }).outcome,
  "partial-warm"
)
assert.equal(
  inferPromptCacheState({
    eligible: true,
    currentRouteId: "route-a",
    usage: unavailable,
  }).outcome,
  "cold-start"
)
assert.equal(
  inferPromptCacheState({
    eligible: true,
    currentRouteId: "route-a",
    prefixPreviouslySubmittedAt: new Date("2026-01-01T00:00:00Z"),
    now: new Date("2026-01-01T00:06:00Z"),
    ttlMs: 5 * 60 * 1000,
    usage: unavailable,
  }).outcome,
  "ttl-expired"
)
assert.equal(
  inferPromptCacheState({
    eligible: true,
    currentRouteId: "route-a",
    prefixPreviouslySubmittedAt: new Date("2026-01-01T00:00:00Z"),
    now: new Date("2026-01-01T00:03:00Z"),
    ttlMs: 5 * 60 * 1000,
    usage: unavailable,
  }).outcome,
  "usage-unavailable"
)

console.log("PASS prompt cache state explanations")
