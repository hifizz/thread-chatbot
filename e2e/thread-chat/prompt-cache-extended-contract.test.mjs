import assert from "node:assert/strict"
import { THREAD_QUOTE_SCHEMA_VERSION } from "../../constants/prompt-cache.ts"
import {
  assertCompleteModelInputBudget,
  defaultModelInputBudget,
} from "../../lib/thread-chat/application/input-budget.ts"
import {
  buildEditedUserParts,
  buildUserParts,
} from "../../lib/thread-chat/application/command-utils.ts"
import { sendMessageCommandSchema } from "../../lib/thread-chat/contracts/commands.ts"
import { normalizePromptCacheUsage } from "../../lib/ai/prompt-cache-usage.ts"
import { runDeterministicCacheProbe } from "../../lib/ai/prompt-cache-probe.ts"
import { resolvePromptCacheRoutePolicy } from "../../lib/ai/prompt-cache-config.ts"

const anchor = {
  quote: { exact: "共同前缀", prefix: "复用", suffix: "降低成本" },
  position: { start: 2, end: 6 },
}
const quote = {
  schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
  quoteId: "00000000-0000-4000-8000-000000000001",
  kind: "selection",
  text: anchor.quote.exact,
  comment: "解释它",
  source: {
    type: "message-selection",
    projectId: "project-a",
    threadId: "thread-a",
    messageId: "message-a",
    anchor,
  },
}

const normalized = normalizePromptCacheUsage({
  usage: {
    inputTokens: 10_000,
    outputTokens: 500,
    inputTokenDetails: { cacheReadTokens: 8_000, cacheWriteTokens: 0 },
  },
  providerMetadata: {
    openrouter: { usage: { cost: 0.0123 } },
  },
})
assert.equal(normalized.cacheReadTokens, 8_000)
assert.equal(normalized.uncachedInputTokens, 2_000)
assert.equal(normalized.totalCostUsd, 0.0123)
assert.equal(normalized.complete, true)

const report = runDeterministicCacheProbe({
  routeId: "fake:umapis-claude",
  rates: {
    uncachedInputPerMillion: 3,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
    outputPerMillion: 15,
  },
})
assert.equal(report.reuse.providerHit, true)
assert.equal(report.routeDrift.providerHit, false)
assert.ok(report.routeDriftPenalty > 0)
assert.equal(report.enableRecommended, true)

const fullCohort = resolvePromptCacheRoutePolicy({
  routeId: "fake:claude",
  globalMode: "enabled",
  cohortIdentity: "user:project:route",
  cohortPercentValue: "100",
})
assert.equal(fullCohort.mode, "enabled")
assert.equal(fullCohort.cohortIncluded, true)

const outsideCohort = resolvePromptCacheRoutePolicy({
  routeId: "fake:claude",
  globalMode: "enabled",
  cohortIdentity: "user:project:route",
  cohortPercentValue: "0",
})
assert.equal(outsideCohort.mode, "observe")
assert.equal(outsideCohort.cohortIncluded, false)
assert.equal(outsideCohort.extendedTtlEnabled, false)

assert.throws(
  () =>
    assertCompleteModelInputBudget({
      modelVisibleText: "x".repeat(600),
      budget: defaultModelInputBudget({
        inputTokenLimit: 100,
        outputTokenReserve: 10,
      }),
    }),
  (error) => error?.code === "INPUT_BUDGET_EXCEEDED"
)

assert.throws(
  () =>
    sendMessageCommandSchema.parse({
      commandId: "00000000-0000-4000-8000-000000000010",
      userMessageId: "00000000-0000-4000-8000-000000000011",
      assistantMessageId: "00000000-0000-4000-8000-000000000012",
      modelId: "model",
      text: "question",
      files: [],
      quotes: [
        {
          source: {
            type: "message-selection",
            sourceThreadId: "00000000-0000-4000-8000-000000000099",
            sourceMessageId: "00000000-0000-4000-8000-000000000002",
            anchor,
          },
        },
      ],
    }),
  /Unrecognized key|unrecognized/i
)

const original = buildUserParts({ text: "旧问题", files: [], quotes: [quote] })
const edited = buildEditedUserParts({
  sourceParts: original,
  text: "新的问题",
  files: [],
})
assert.equal(edited[0].type, "data-quote")
assert.equal(edited[0].data.quoteId, original[0].data.quoteId)
assert.equal(edited[0].data.comment, "解释它")
assert.equal(edited.at(-1).text, "新的问题")

console.log("prompt cache extended contract tests passed")
