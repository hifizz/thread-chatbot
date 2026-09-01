import assert from "node:assert/strict"
import test from "node:test"

import {
  isPromptCacheControlRejection,
  withCacheControlFallback,
} from "../../lib/thread-chat/prompt-cache/cache-control-fallback.ts"

function usage(inputTokens = 1) {
  return Promise.resolve({
    inputTokens,
    outputTokens: 1,
    totalTokens: inputTokens + 1,
  })
}

function streamOf(parts) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

async function collect(stream) {
  const values = []
  for await (const value of stream) values.push(value)
  return values
}

test("recognizes only cache-control compatibility errors", () => {
  assert.equal(
    isPromptCacheControlRejection({
      status: 400,
      message: "unknown cache_control field",
    }),
    true
  )
  assert.equal(
    isPromptCacheControlRejection({
      status: 401,
      message: "invalid API key",
    }),
    false
  )
  assert.equal(
    isPromptCacheControlRejection({
      status: 429,
      message: "prompt cache quota exceeded",
    }),
    false
  )
})

test("falls back once before any output is exposed", async () => {
  let fallbackCalls = 0
  const result = withCacheControlFallback({
    enabled: true,
    primary: () => ({
      stream: streamOf([
        {
          type: "error",
          error: { status: 400, message: "cache control is unsupported" },
        },
      ]),
      usage: usage(),
    }),
    fallback: () => {
      fallbackCalls += 1
      return {
        stream: streamOf([
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", text: "ok" },
          { type: "text-end", id: "text-1" },
        ]),
        usage: usage(2),
      }
    },
  })
  const parts = await collect(result.stream)
  assert.equal(fallbackCalls, 1)
  assert.equal(await result.fallbackUsed, true)
  assert.equal(parts.some((part) => part.type === "error"), false)
  assert.equal(parts.some((part) => part.type === "text-delta"), true)
  assert.equal((await result.usage).inputTokens, 2)
})

test("does not retry after output was exposed", async () => {
  let fallbackCalls = 0
  const result = withCacheControlFallback({
    enabled: true,
    primary: () => ({
      stream: streamOf([
        { type: "text-start", id: "text-1" },
        {
          type: "error",
          error: { status: 400, message: "cache_control rejected" },
        },
      ]),
      usage: usage(),
    }),
    fallback: () => {
      fallbackCalls += 1
      return { stream: streamOf([]), usage: usage(2) }
    },
  })
  const parts = await collect(result.stream)
  assert.equal(fallbackCalls, 0)
  assert.equal(await result.fallbackUsed, false)
  assert.equal(parts.at(-1)?.type, "error")
})

test("does not hide authentication or quota failures", async () => {
  for (const failure of [
    { status: 401, message: "invalid API key" },
    { status: 429, message: "prompt cache quota exceeded" },
  ]) {
    let fallbackCalls = 0
    const result = withCacheControlFallback({
      enabled: true,
      primary: () => ({
        stream: streamOf([{ type: "error", error: failure }]),
        usage: usage(),
      }),
      fallback: () => {
        fallbackCalls += 1
        return { stream: streamOf([]), usage: usage(2) }
      },
    })
    const parts = await collect(result.stream)
    assert.equal(fallbackCalls, 0)
    assert.equal(parts[0]?.type, "error")
  }
})
