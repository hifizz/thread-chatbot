import assert from "node:assert/strict"
import { createStreamLifecycle } from "../../app/api/chat/stream-lifecycle.ts"

const model = { id: "glm-5.3", provider: "ark" }
const base = {
  userId: "user-1",
  modelId: "glm-5.3",
  model,
  persistentGeneration: true,
  unbilledPreview: false,
}

const originalError = console.error
console.error = () => {}
try {
  const lifecycle = createStreamLifecycle(base, {
    async charge() {
      assert.fail("persistent generation must not charge outside finalization")
    },
  })
  lifecycle.onError({ error: new Error("stream broke") })
  lifecycle.onAbort({
    steps: [
      {
        usage: { inputTokens: 3, outputTokens: 5 },
        providerMetadata: { gateway: { generationId: "gateway-1" } },
      },
      { usage: { inputTokens: 7, outputTokens: 11 } },
    ],
  })
  assert.deepEqual(lifecycle.snapshot(), {
    capturedUsage: {
      inputTokens: 10,
      outputTokens: 16,
      costEvidence: { source: "estimate" },
    },
    capturedProviderMetadata: undefined,
    modelStreamError: "stream broke",
    abortedUsageUnavailable: true,
  })

  const emptyAbort = createStreamLifecycle(base)
  emptyAbort.onAbort({ steps: [] })
  assert.deepEqual(emptyAbort.snapshot(), {
    capturedUsage: undefined,
    capturedProviderMetadata: undefined,
    modelStreamError: undefined,
    abortedUsageUnavailable: true,
  })

  const unknownError = createStreamLifecycle(base)
  unknownError.onError({ error: { upstream: "opaque" } })
  assert.equal(unknownError.snapshot().modelStreamError, "生成失败，请重试。")

  await lifecycle.onEnd({
    usage: { inputTokens: 13, outputTokens: 17 },
    providerMetadata: { gateway: { generationId: "gateway-2" } },
    steps: [],
  })
  assert.deepEqual(lifecycle.snapshot().capturedUsage, {
    inputTokens: 13,
    outputTokens: 17,
    costEvidence: {
      source: "vercel-gateway",
      generationId: "gateway-2",
    },
  })

  const charges = []
  const linear = createStreamLifecycle(
    {
      ...base,
      persistentGeneration: false,
      linearThreadId: "linear-1",
    },
    {
      async charge(input) {
        charges.push(input)
      },
    }
  )
  linear.onAbort({ steps: [{ usage: { inputTokens: 99 } }] })
  await linear.onEnd({
    usage: { inputTokens: 2, outputTokens: 4 },
    steps: [],
  })
  assert.deepEqual(linear.snapshot(), {
    capturedUsage: undefined,
    capturedProviderMetadata: undefined,
    modelStreamError: undefined,
    abortedUsageUnavailable: false,
  })
  assert.deepEqual(charges, [
    {
      userId: "user-1",
      model: "glm-5.3",
      inputTokens: 2,
      outputTokens: 4,
      threadId: "linear-1",
      costEvidence: { source: "estimate" },
    },
  ])

  const preview = createStreamLifecycle(
    { ...base, unbilledPreview: true },
    {
      async charge() {
        assert.fail("preview must not charge")
      },
    }
  )
  await preview.onEnd({
    usage: { inputTokens: 100, outputTokens: 200 },
    steps: [],
  })
  assert.equal(preview.snapshot().capturedUsage, undefined)
} finally {
  console.error = originalError
}

console.log(
  "PASS  stream lifecycle isolates errors, abort usage, persistent capture, linear charge, and preview bypass"
)
