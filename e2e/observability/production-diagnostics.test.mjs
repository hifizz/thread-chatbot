import assert from "node:assert/strict"
import { runAgentTrace } from "../../lib/observability/trace.ts"
import { diagnosticCorrelation } from "../../lib/observability/diagnostic-log.ts"
import { buildThreadChatTraceInput } from "../../lib/observability/context.ts"
import { createResearchTools } from "../../lib/chat/research-tools.ts"
import { createWebBudget, availableResearchTools } from "../../lib/ai/web-access.ts"

const logs = []
const originalWarn = console.warn
const originalError = console.error
const originalFetch = globalThis.fetch
const originalEnv = process.env.NODE_ENV
process.env.NODE_ENV = "production"
console.warn = (prefix, json) => { if (prefix === "[ai-diagnostic]") logs.push(JSON.parse(json)) }
console.error = console.warn
try {
  globalThis.fetch = async () => new Response("private upstream body", { status: 429 })
  const inputs = await Promise.all(["a", "b"].map((id) => buildThreadChatTraceInput({
    userId: `user-${id}`, projectId: `project-${id}`, threadId: `thread-${id}`,
    assistantMessageId: `message-${id}`, modelId: "test",
  })))
  await Promise.all(inputs.map((input) => runAgentTrace(input, async () => {
    const budget = createWebBudget({ maxProviderAttempts: 1 })
    const tools = createResearchTools({ budget })
    const options = { toolCallId: `call-${input.context.assistantMessageId}`, messages: [] }
    const result = await tools.webSearch.execute({ query: "secret query" }, options)
    assert.equal(result.ok, false)
    assert.equal(diagnosticCorrelation().traceId, input.traceId)
    assert.deepEqual(availableResearchTools(["webSearch", "readUrl"], budget), [])
    const blocked = await tools.readUrl.execute({ url: "https://example.com/?token=secret" }, { ...options, toolCallId: `${options.toolCallId}-blocked` })
    assert.equal(blocked.error.code, "WEB_BUDGET_EXHAUSTED")
  })))
  for (const input of inputs) {
    const own = logs.filter((entry) => entry.assistantMessageId === input.context.assistantMessageId)
    assert.ok(own.length >= 4)
    assert.ok(own.every((entry) => entry.sessionId === input.sessionId && entry.traceId === input.traceId && entry.threadId === input.context.threadId && entry.requestId === input.context.requestId))
    const provider = own.find((entry) => entry.event === "provider.failure")
    assert.equal(provider.httpStatus, 429)
    assert.equal(provider.errorCategory, "rate_limit")
    assert.equal(provider.toolCallId, `call-${input.context.assistantMessageId}`)
    assert.ok(provider.durationMs >= 0)
    assert.ok(own.some((entry) => entry.event === "tool.failure" && entry.errorCode === "WEB_BUDGET_EXHAUSTED"))
    assert.ok(own.some((entry) => entry.event === "web.budget_tools_removed"))
  }
  await runAgentTrace(inputs[0], async () => {
    await import("../thread-chat/normalized-ui-message-pipeline.test.mjs")
    const budget = createWebBudget({ maxDurationMs: 1 })
    await budget.run(undefined, async () => true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.deepEqual(availableResearchTools(["webSearch"], budget), [])
    assert.equal(budget.exhaustedReason, "deadline")
    const contentBudget = createWebBudget({ maxContentChars: 1 })
    contentBudget.spendContent(1)
    assert.deepEqual(availableResearchTools(["webSearch"], contentBudget), [])
    assert.equal(contentBudget.exhaustedReason, "content")
  })
  const streamErrors = logs.filter((entry) => entry.event === "stream.error")
  assert.ok(streamErrors.length >= 1)
  assert.ok(streamErrors.every((entry) => entry.traceId === inputs[0].traceId && entry.sessionId === inputs[0].sessionId))
  assert.equal(diagnosticCorrelation().assistantMessageId, undefined)
  assert.ok(!JSON.stringify(logs).includes("secret"))
  assert.ok(!JSON.stringify(logs).includes("private upstream body"))
  console.info("生产诊断：429、预算拦截、并发关联、脱敏通过")
} finally {
  console.warn = originalWarn
  console.error = originalError
  globalThis.fetch = originalFetch
  if (originalEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalEnv
}
