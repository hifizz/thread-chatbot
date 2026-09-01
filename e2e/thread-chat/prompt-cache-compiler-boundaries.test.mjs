import assert from "node:assert/strict"
import { buildPromptCacheAdapterPlan } from "../../lib/ai/prompt-cache-adapter.ts"
import { finalizeGenerationPrompt } from "../../lib/thread-chat/application/prompt-compiler.ts"

const system = "stable-kernel"
const inheritedMessages = [
  { role: "user", content: "A".repeat(6000) },
  { role: "assistant", content: "inherited-answer" },
]
const branchHistoryMessages = [
  { role: "user", content: "branch-question" },
  { role: "assistant", content: "branch-answer" },
]
const currentUserMessage = { role: "user", content: "current-question" }
const base = {
  system,
  inheritedMessages,
  branchHistoryMessages,
  currentUserMessage,
  currentUserQuoteCount: 0,
  currentUserQuoteCharacters: 0,
  baseSegments: [
    {
      kind: "agent-kernel",
      stability: "stable-prefix",
      version: "test",
      characters: system.length,
      contentHash: "kernel",
      messageCount: 1,
    },
    {
      kind: "inherited-history",
      stability: "stable-prefix",
      version: "test",
      characters: 6000,
      contentHash: "inherited",
      messageCount: inheritedMessages.length,
    },
    {
      kind: "branch-history",
      stability: "stable-prefix",
      version: "test",
      characters: 1000,
      contentHash: "branch",
      messageCount: branchHistoryMessages.length,
    },
  ],
  forkContextHash: "fork-context",
}
const tools = {}
const adapter = buildPromptCacheAdapterPlan({
  strategy: "explicit-breakpoint",
  candidates: [
    { kind: "kernel-end", tokenEstimate: 1200 },
    { kind: "inherited-end", tokenEstimate: 4000 },
    { kind: "branch-history-end", tokenEstimate: 5000 },
  ],
  minimumPrefixTokens: 1000,
  maximumBreakpoints: 3,
  ttlClass: "5m",
})
assert.equal(adapter.enabled, true)
assert.deepEqual(
  adapter.markers.map((marker) => marker.boundary),
  ["inherited-end", "branch-history-end", "kernel-end"]
)

const compiled = finalizeGenerationPrompt({
  base,
  tools,
  toolProfileId: "thread-answer-v1",
  toolProfileHash: "tools",
  routeId: "anthropic:direct:test",
  cacheMarkers: adapter.markers,
})
const fallback = finalizeGenerationPrompt({
  base,
  tools,
  toolProfileId: "thread-answer-v1",
  toolProfileHash: "tools",
  routeId: "anthropic:direct:test",
})

const expectedAnthropicMarker = {
  anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } },
}
assert.equal(typeof compiled.system, "object")
assert.deepEqual(compiled.system.providerOptions, expectedAnthropicMarker)
assert.deepEqual(compiled.messages[1].providerOptions, expectedAnthropicMarker)
assert.deepEqual(compiled.messages[3].providerOptions, expectedAnthropicMarker)
assert.equal(
  "providerOptions" in compiled.messages.at(-1),
  false,
  "current user must remain after every stable cache boundary"
)
assert.notEqual(
  compiled.manifest.stableRequestPrefixHash,
  fallback.manifest.stableRequestPrefixHash,
  "marker position and provider-visible options must participate in the request hash"
)
assert.deepEqual(
  fallback.messages.map((message) => "providerOptions" in message),
  [false, false, false, false, false]
)

const gateway = buildPromptCacheAdapterPlan({
  strategy: "gateway-auto",
  candidates: [],
  minimumPrefixTokens: 0,
  maximumBreakpoints: 0,
  ttlClass: "provider-default",
})
assert.deepEqual(gateway.providerOptions, { gateway: { caching: "auto" } })
assert.equal(gateway.markers.length, 0)

console.log("PASS compiled prompt cache boundary markers")
