import assert from "node:assert/strict"
import test from "node:test"

import {
  FakePromptCacheProbeAdapter,
  PROMPT_CACHE_ROUTE_PROBE_TABLE,
  runPromptCacheProbe,
} from "../../lib/thread-chat/prompt-cache/route-probe.ts"

test("keeps UMAPIS Claude probe-required until live evidence exists", () => {
  const umapis = PROMPT_CACHE_ROUTE_PROBE_TABLE.find(
    (record) => record.routeClass === "umapis-claude"
  )
  assert.equal(umapis?.initialState, "probe-required")
  assert.equal(umapis?.evidence, "unverified")
  assert.equal(umapis?.supportedTtls.includes("1h"), false)
})

test("recommends enabling only when output is equivalent, read is proven and cost falls", async () => {
  const result = await runPromptCacheProbe({
    adapter: new FakePromptCacheProbeAdapter(),
    stablePrefix: "shared-history",
    warmupTail: "question-a",
    reuseTail: "question-b",
  })
  assert.equal(result.outputEquivalent, true)
  assert.equal(result.cacheReadProven, true)
  assert.equal(result.totalCostReduced, true)
  assert.equal(result.enableRecommended, true)
  assert.equal(result.reason, "verified-cheaper")
})

test("blocks a cheaper route when output quality changes", async () => {
  const result = await runPromptCacheProbe({
    adapter: new FakePromptCacheProbeAdapter({ qualityRegression: true }),
    stablePrefix: "shared-history",
    warmupTail: "question-a",
    reuseTail: "question-b",
  })
  assert.equal(result.enableRecommended, false)
  assert.equal(result.reason, "quality-regression")
})

test("does not claim savings when provider cost evidence is unavailable", async () => {
  const result = await runPromptCacheProbe({
    adapter: new FakePromptCacheProbeAdapter({ returnCost: false }),
    stablePrefix: "shared-history",
    warmupTail: "question-a",
    reuseTail: "question-b",
  })
  assert.equal(result.cacheReadProven, true)
  assert.equal(result.totalCostReduced, null)
  assert.equal(result.enableRecommended, false)
  assert.equal(result.reason, "cost-unavailable")
})
