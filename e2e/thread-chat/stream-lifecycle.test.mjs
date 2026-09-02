import assert from "node:assert/strict"
import { createStreamLifecycle } from "../../app/api/chat/stream-lifecycle.ts"

const base = {
  userId: "user-1",
  modelId: "glm-5.3",
  model: { id: "glm-5.3", provider: "ark" },
  unbilledPreview: false,
  linearThreadId: "linear-1",
}

const originalError = console.error
console.error = () => {}
try {
  const charges = []
  const lifecycle = createStreamLifecycle(base, {
    async charge(input) {
      charges.push(input)
    },
  })
  lifecycle.onError({ error: new Error("stream broke") })
  lifecycle.onAbort({ steps: [{ usage: { inputTokens: 99 } }] })
  assert.deepEqual(lifecycle.snapshot(), {
    modelStreamError: "生成失败，请重试。",
  })
  await lifecycle.onEnd({
    usage: { inputTokens: 2, outputTokens: 4 },
    steps: [],
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
} finally {
  console.error = originalError
}

console.log(
  "PASS  linear chat stream lifecycle isolates errors, charges once, and bypasses preview billing"
)
