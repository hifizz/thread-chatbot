import assert from "node:assert/strict"
import { usageCostEvidence } from "../../lib/billing/usage-cost-evidence.ts"

const gatewayMetadata = { gateway: { generationId: "gateway-generation" } }

assert.deepEqual(
  usageCostEvidence({
    provider: "openrouter",
    steps: [
      { providerMetadata: { openrouter: { usage: { cost: 0.012 } } } },
      { providerMetadata: { openrouter: { usage: { cost: 0.008 } } } },
    ],
    providerMetadata: gatewayMetadata,
  }),
  { source: "openrouter", costUsd: 0.02 }
)

assert.deepEqual(
  usageCostEvidence({
    provider: "openrouter",
    steps: [{ providerMetadata: {} }],
    providerMetadata: gatewayMetadata,
  }),
  { source: "vercel-gateway", generationId: "gateway-generation" }
)

assert.deepEqual(
  usageCostEvidence({
    provider: "ark",
    steps: [{ providerMetadata: { openrouter: { usage: { cost: 999 } } } }],
    providerMetadata: gatewayMetadata,
  }),
  { source: "vercel-gateway", generationId: "gateway-generation" }
)

for (const providerMetadata of [
  undefined,
  null,
  {},
  { gateway: null },
  { gateway: { generationId: 42 } },
]) {
  assert.deepEqual(
    usageCostEvidence({
      provider: "private-relay",
      steps: [],
      providerMetadata,
    }),
    { source: "estimate" }
  )
}

console.log(
  "PASS  usage cost evidence preserves OpenRouter, Gateway, and estimate priority"
)
