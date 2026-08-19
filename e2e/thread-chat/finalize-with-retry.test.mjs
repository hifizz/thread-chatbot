import assert from "node:assert/strict"
import { finalizeGenerationWithRetry } from "../../lib/thread-chat-generation/finalize-with-retry.ts"

const input = {
  generationId: "11111111-1111-4111-8111-111111111111",
  outcome: "completed",
  result: {
    version: 1,
    generationId: "11111111-1111-4111-8111-111111111111",
    text: "done",
    status: "done",
    artifactIds: [],
    artifacts: {},
  },
}

const originalError = console.error
console.error = () => {}
try {
  let attempts = 0
  const delays = []
  const value = await finalizeGenerationWithRetry(input, {
    async finalize(received) {
      attempts++
      assert.equal(received, input)
      if (attempts < 3) throw new Error(`failure-${attempts}`)
      return "settled"
    },
    async delay(ms) {
      delays.push(ms)
    },
  })
  assert.equal(value, "settled")
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [150, 300])

  let failedAttempts = 0
  await assert.rejects(
    () =>
      finalizeGenerationWithRetry(input, {
        async finalize() {
          failedAttempts++
          throw new Error(`terminal-${failedAttempts}`)
        },
        async delay() {},
      }),
    /terminal-3/
  )
  assert.equal(failedAttempts, 3)
} finally {
  console.error = originalError
}

console.log(
  "PASS  generation finalization retries three times with bounded backoff and throws the last error"
)
