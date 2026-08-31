import assert from "node:assert/strict"
import {
  parsePromptCacheRouteModes,
  resolvePromptCacheModeForRoute,
  selectPromptCacheTtl,
} from "../../lib/ai/prompt-cache.ts"
import { createPromptCacheFallbackStream } from "../../lib/ai/prompt-cache-fallback-stream.ts"

assert.deepEqual(
  parsePromptCacheRouteModes(
    JSON.stringify({
      "anthropic:umapis:claude": "enabled",
      "private-relay": "off",
      bad: "unknown",
    })
  ),
  {
    "anthropic:umapis:claude": "enabled",
    "private-relay": "off",
  }
)
assert.deepEqual(parsePromptCacheRouteModes("not-json"), {})

const routeInput = {
  routeId: "anthropic:umapis:claude",
  userId: "user-a",
  projectId: "project-a",
  cohortSalt: "cohort-salt",
}
assert.equal(
  resolvePromptCacheModeForRoute({
    ...routeInput,
    globalMode: "off",
    routeModes: { [routeInput.routeId]: "enabled" },
    cohortPercent: 100,
  }),
  "enabled"
)
assert.equal(
  resolvePromptCacheModeForRoute({
    ...routeInput,
    globalMode: "enabled",
    cohortPercent: 0,
  }),
  "observe"
)
assert.equal(
  resolvePromptCacheModeForRoute({
    ...routeInput,
    globalMode: "enabled",
    cohortPercent: 50,
  }),
  resolvePromptCacheModeForRoute({
    ...routeInput,
    globalMode: "enabled",
    cohortPercent: 50,
  }),
  "cohort assignment must be stable"
)

assert.equal(
  selectPromptCacheTtl({ supportedTtls: ["provider-default", "5m", "1h"] }),
  "5m"
)
assert.equal(
  selectPromptCacheTtl({
    supportedTtls: ["provider-default", "5m", "1h"],
    extendedEnabled: true,
    retentionAllowsExtended: false,
  }),
  "5m",
  "extended TTL requires retention approval"
)
assert.equal(
  selectPromptCacheTtl({
    supportedTtls: ["provider-default", "5m", "1h"],
    extendedEnabled: true,
    retentionAllowsExtended: true,
  }),
  "1h"
)

function streamOf(chunks, usage) {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    usage: Promise.resolve(usage),
  }
}

function errorStream(error) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.error(error)
      },
    }),
    usage: Promise.reject(error),
  }
}

let fallbackCalls = 0
const fallback = createPromptCacheFallbackStream({
  primary: () => errorStream(new Error("cache_control invalid 400")),
  fallback: () => {
    fallbackCalls += 1
    return streamOf(["fallback-output"], { inputTokens: 10 })
  },
  isCacheControlRejection: (error) => /cache_control/.test(String(error)),
  enabled: true,
})
const reader = fallback.stream.getReader()
const chunks = []
while (true) {
  const next = await reader.read()
  if (next.done) break
  chunks.push(next.value)
}
assert.deepEqual(chunks, ["fallback-output"])
assert.deepEqual(await fallback.usage, { inputTokens: 10 })
assert.equal(fallback.usedFallback(), true)
assert.equal(typeof fallback.ttftMs(), "number")

let unsafeFallbackCalls = 0
const partialThenError = createPromptCacheFallbackStream({
  primary: () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue("partial")
        // Deliver the queued protocol chunk before failing. A synchronous
        // controller.error() discards queued chunks and does not model visible
        // output, so it cannot exercise the no-retry-after-output contract.
        queueMicrotask(() =>
          controller.error(new Error("cache_control invalid 400"))
        )
      },
    }),
    usage: Promise.reject(new Error("cache_control invalid 400")),
  }),
  fallback: () => {
    unsafeFallbackCalls += 1
    return streamOf(["must-not-run"], {})
  },
  isCacheControlRejection: (error) => /cache_control/.test(String(error)),
  enabled: true,
})
const unsafeReader = partialThenError.stream.getReader()
assert.deepEqual(await unsafeReader.read(), { value: "partial", done: false })
await assert.rejects(unsafeReader.read(), /cache_control/)
assert.equal(unsafeFallbackCalls, 0, "never retry after any protocol output")
assert.equal(partialThenError.usedFallback(), false)

console.log("PASS prompt cache rollout, TTL and fallback contracts")
