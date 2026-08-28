import assert from "node:assert/strict"
import { webSearch, extractUrl } from "../../lib/ai/search.ts"
import {
  fingerprintProviderQuery,
  providerUrlDomain,
  runProviderAttempt,
  setProviderAttemptEventConsumerForTests,
} from "../../lib/observability/provider-attempt.ts"
import {
  runAgentTrace,
  setAgentTraceBackendForTests,
} from "../../lib/observability/trace.ts"
import { assistantMessageTraceId } from "../../lib/observability/identity.ts"
import { TRACE_NAMES } from "../../constants/observability.ts"

const events = []
const observations = []
const stack = []
let observationId = 0
setProviderAttemptEventConsumerForTests((event) =>
  events.push(structuredClone(event))
)
setAgentTraceBackendForTests({
  runRoot(input, fn) {
    const root = {
      id: `root-${++observationId}`,
      name: input.name,
      traceId: input.traceId,
      parentId: null,
      updates: [],
      ended: false,
    }
    observations.push(root)
    stack.push(root)
    const result = fn({
      id: root.id,
      traceId: root.traceId,
      update: (attributes) => root.updates.push(structuredClone(attributes)),
      end: () => {
        root.ended = true
      },
    })
    return Promise.resolve(result).finally(() => stack.pop())
  },
  observe(name, attributes, fn) {
    const parent = stack.at(-1)
    const node = {
      id: `observation-${++observationId}`,
      name,
      traceId: parent?.traceId ?? "standalone",
      parentId: parent?.id ?? null,
      attributes: structuredClone(attributes),
      updates: [],
      ended: false,
    }
    observations.push(node)
    stack.push(node)
    const result = fn({
      id: node.id,
      traceId: node.traceId,
      update: (update) => node.updates.push(structuredClone(update)),
      end: () => {
        node.ended = true
      },
    })
    return Promise.resolve(result).finally(() => stack.pop())
  },
})

const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          results: [
            {
              title: "Result",
              url: "https://example.com/private/path?token=secret",
              snippet: "Allowed public snippet",
            },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  const privateQuery = "person@example.com confidential acquisition"
  const search = await webSearch(privateQuery, 5, undefined, {
    routeReason: "freshness_required",
  })
  assert.equal(search.results.length, 1)
  const successfulSearch = events.find(
    (event) =>
      event.operation === "search" &&
      event.phase === "finish" &&
      event.outcome === "success"
  )
  assert.equal(successfulSearch.resultCount, 1)
  assert.equal(successfulSearch.routeReason, "freshness_required")
  assert.equal(successfulSearch.usageUnit, "request")
  assert.equal(successfulSearch.usageQuantity, 1)
  assert.equal(
    successfulSearch.queryFingerprint,
    fingerprintProviderQuery(privateQuery)
  )

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        result: { content: [{ type: "text", text: "page markdown" }] },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  const privateUrl = "https://docs.example.com/private?a=1&token=secret"
  assert.equal(await extractUrl(privateUrl), "page markdown")
  const successfulExtract = events.find(
    (event) =>
      event.operation === "extract" &&
      event.phase === "finish" &&
      event.outcome === "success"
  )
  assert.equal(successfulExtract.domain, "docs.example.com")
  assert.equal(successfulExtract.responseCharacters, 13)

  const eventPayload = JSON.stringify(events)
  for (const forbidden of [
    privateQuery,
    "person@example.com",
    privateUrl,
    "?a=1",
    "token=secret",
    "page markdown",
    "Allowed public snippet",
  ]) {
    assert.ok(
      !eventPayload.includes(forbidden),
      `provider event 泄漏了 ${forbidden}`
    )
  }
  assert.equal(
    providerUrlDomain("https://user:pass@example.com/private?secret=1"),
    "example.com"
  )

  for (const [status, expected] of [
    [401, "authentication"],
    [429, "rate_limit"],
    [503, "provider_error"],
  ]) {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "raw provider secret" }), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    await assert.rejects(() => webSearch(`failure-${status}`))
    const event = events.at(-1)
    assert.equal(event.outcome, expected)
    assert.ok(!JSON.stringify(event).includes("raw provider secret"))
  }

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: { results: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  assert.deepEqual(await webSearch("empty fixture"), { results: [] })
  assert.equal(events.at(-1).outcome, "empty")

  const syntheticFailures = [
    [new DOMException("stopped", "AbortError"), "cancelled"],
    [new DOMException("deadline", "TimeoutError"), "timeout"],
    [
      Object.assign(new Error("unusable"), { code: "UNUSABLE_RESULT" }),
      "unusable",
    ],
    [
      Object.assign(new Error("budget"), { code: "BUDGET_EXHAUSTED" }),
      "budget_exhausted",
    ],
  ]
  for (const [error, expected] of syntheticFailures) {
    await assert.rejects(() =>
      runProviderAttempt(
        {
          provider: "FixtureProvider",
          operation: "search",
          query: "private fixture",
        },
        async () => {
          throw error
        },
        () => ({ outcome: "success" })
      )
    )
    assert.equal(events.at(-1).outcome, expected)
  }

  const traceId = await assistantMessageTraceId("provider-fallback-trace")
  await runAgentTrace(
    {
      name: TRACE_NAMES.threadChatGeneration,
      traceId,
      sessionId: "project-provider",
      context: {
        projectId: "project-provider",
        threadId: "thread-provider",
        assistantMessageId: "provider-fallback-trace",
        environment: "test",
        release: "contract",
      },
    },
    async () => {
      await runProviderAttempt(
        {
          provider: "Primary",
          operation: "search",
          query: "fallback fixture",
          attemptIndex: 0,
          fallbackCount: 0,
        },
        async () => {
          throw Object.assign(new Error("rate limited"), { status: 429 })
        },
        () => ({ outcome: "success" })
      ).catch(() => undefined)
      await runProviderAttempt(
        {
          provider: "Fallback",
          operation: "search",
          query: "fallback fixture",
          attemptIndex: 1,
          fallbackCount: 1,
        },
        async () => ({ results: [{ id: 1 }] }),
        ({ results }) => ({ outcome: "success", resultCount: results.length })
      )
    }
  )
  const fallbackObservations = observations.filter((node) =>
    node.name.includes("search.provider-attempt")
  )
  assert.equal(fallbackObservations.at(-2).traceId, traceId)
  assert.equal(fallbackObservations.at(-1).traceId, traceId)
  assert.equal(events.at(-2).fallbackCount, 1)
  assert.equal(events.at(-2).attemptIndex, 1)
} finally {
  globalThis.fetch = originalFetch
  setProviderAttemptEventConsumerForTests(null)
  setAgentTraceBackendForTests(null)
}

console.info("provider attempt observability contracts passed")
