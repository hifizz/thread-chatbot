import assert from "node:assert/strict"
import { createCacheFallbackStream } from "../../lib/ai/cache-fallback-stream.ts"

function streamFrom(chunks, finalError) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      if (finalError) controller.error(finalError)
      else controller.close()
    },
  })
}

async function collect(stream) {
  const values = []
  const reader = stream.getReader()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return values
      values.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
}

let attempts = 0
const fallback = createCacheFallbackStream({
  cacheControlEnabled: true,
  createAttempt(enabled) {
    attempts += 1
    return enabled
      ? {
          stream: streamFrom([
            {
              type: "error",
              error: new Error("unsupported provider option cache_control"),
            },
          ]),
          usage: Promise.resolve({ inputTokens: 0 }),
        }
      : {
          stream: streamFrom([{ type: "text-delta", text: "ok" }]),
          usage: Promise.resolve({ inputTokens: 10 }),
        }
  },
})
assert.deepEqual(await collect(fallback.stream), [
  { type: "text-delta", text: "ok" },
])
assert.deepEqual(await fallback.usage, { inputTokens: 10 })
assert.equal(await fallback.fallbackUsed, true)
assert.equal(attempts, 2)

let postOutputAttempts = 0
const postOutput = createCacheFallbackStream({
  cacheControlEnabled: true,
  createAttempt() {
    postOutputAttempts += 1
    return {
      stream: streamFrom(
        [{ type: "text-delta", text: "partial" }],
        new Error("unsupported provider option cache_control")
      ),
      usage: Promise.resolve({ inputTokens: 10 }),
    }
  },
})
await assert.rejects(collect(postOutput.stream), /cache_control/)
assert.equal(await postOutput.fallbackUsed, false)
assert.equal(postOutputAttempts, 1)

let authAttempts = 0
const authFailure = createCacheFallbackStream({
  cacheControlEnabled: true,
  createAttempt() {
    authAttempts += 1
    return {
      stream: streamFrom([], new Error("authentication failed")),
      usage: Promise.resolve({ inputTokens: 0 }),
    }
  },
})
await assert.rejects(collect(authFailure.stream), /authentication/)
assert.equal(await authFailure.fallbackUsed, false)
assert.equal(authAttempts, 1)

console.log("cache fallback stream tests passed")
