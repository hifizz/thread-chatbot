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
let callbackLatency
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
  onFirstChunk(latencyMs) {
    callbackLatency = latencyMs
  },
})
assert.deepEqual(await collect(fallback.stream), [
  { type: "text-delta", text: "ok" },
])
const measured = await fallback.firstChunkLatencyMs
assert.ok(measured >= 0)
assert.equal(callbackLatency, measured)
assert.equal(await fallback.fallbackUsed, true)
assert.equal(attempts, 2)

const noOutput = createCacheFallbackStream({
  cacheControlEnabled: false,
  createAttempt() {
    return {
      stream: streamFrom([]),
      usage: Promise.resolve({ inputTokens: 0 }),
    }
  },
})
assert.deepEqual(await collect(noOutput.stream), [])
assert.equal(await noOutput.firstChunkLatencyMs, undefined)

console.log("prompt cache fallback latency tests passed")
