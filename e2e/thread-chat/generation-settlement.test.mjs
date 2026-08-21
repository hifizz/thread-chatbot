import assert from "node:assert/strict"
import {
  createGenerationSettlementHandler,
  settleGenerationInitializationFailure,
} from "../../app/api/chat/generation-settlement.ts"

const persistence = {
  treeId: "11111111-1111-4111-8111-111111111111",
  threadId: "main",
  userMessageId: "u1",
  assistantMessageId: "a1",
  generationId: "22222222-2222-4222-8222-222222222222",
  intent: { kind: "persisted-turn" },
}
const researchRoute = {
  mode: "answer",
  reasonCode: "no_web_needed",
  urls: [],
  suggestedQueries: [],
}
const result = { error: "projected-error" }

async function runSettlement({
  isAborted = false,
  finishReason = "stop",
  hasDisplayableOutput = true,
  snapshot = {},
  unbilledPreview = false,
} = {}) {
  const calls = []
  const handler = createGenerationSettlementHandler(
    {
      persistence,
      researchRoute,
      researchPlan: null,
      unbilledPreview,
      streamLifecycle: {
        snapshot: () => ({
          capturedUsage: undefined,
          modelStreamError: undefined,
          abortedUsageUnavailable: false,
          ...snapshot,
        }),
      },
    },
    {
      project(input) {
        calls.push({ kind: "project", input })
        return { result, hasDisplayableOutput }
      },
      async finalize(input) {
        calls.push({ kind: "finalize", input })
      },
    }
  )
  await handler({
    responseMessage: { parts: [{ type: "text", text: "done" }] },
    isAborted,
    finishReason,
  })
  return calls
}

const completed = await runSettlement()
assert.equal(completed[0].input.terminalStatus, "completed")
assert.equal(completed[1].input.outcome, "completed")
assert.equal(
  completed[1].input.usageUnavailable,
  true,
  "付费 generation 完成但缺少 usage 时必须进入待对账状态"
)

const empty = await runSettlement({ hasDisplayableOutput: false })
assert.equal(empty[0].input.terminalStatus, "completed")
assert.equal(empty[1].input.outcome, "failed")

const aborted = await runSettlement({
  isAborted: true,
  snapshot: {
    capturedUsage: { inputTokens: 3, outputTokens: 5 },
    abortedUsageUnavailable: true,
  },
})
assert.equal(aborted[0].input.terminalStatus, "stopped")
assert.deepEqual(aborted[0].input.usage, {
  inputTokens: 3,
  outputTokens: 5,
  totalTokens: 8,
})
assert.equal(aborted[1].input.outcome, "stopped")
assert.equal(aborted[1].input.usageUnavailable, true)

const failed = await runSettlement({
  finishReason: null,
  snapshot: { modelStreamError: "stream failed" },
})
assert.equal(failed[0].input.terminalStatus, "failed")
assert.equal(failed[1].input.outcome, "failed")
assert.equal(failed[1].input.usageUnavailable, true)

const preview = await runSettlement({
  unbilledPreview: true,
  snapshot: { capturedUsage: { inputTokens: 13, outputTokens: 21 } },
})
assert.equal(preview[1].input.usage, undefined)
assert.equal(preview[1].input.usageUnavailable, false)

const initializationCalls = []
await settleGenerationInitializationFailure(
  {
    persistence,
    error: new Error("initialization broke"),
    usageUnavailable: true,
  },
  {
    project(input) {
      initializationCalls.push({ kind: "project", input })
      return { result, hasDisplayableOutput: false }
    },
    async finalize(input) {
      initializationCalls.push({ kind: "finalize", input })
    },
  }
)
assert.equal(initializationCalls[0].input.error, "生成失败，请重试。")
assert.equal(initializationCalls[1].input.outcome, "failed")
assert.equal(initializationCalls[1].input.usageUnavailable, true)

const originalError = console.error
console.error = () => {}
try {
  await settleGenerationInitializationFailure(
    { persistence, error: "opaque", usageUnavailable: false },
    {
      project(input) {
        assert.equal(input.error, "生成失败，请重试。")
        return { result, hasDisplayableOutput: false }
      },
      async finalize() {
        throw new Error("settlement failed")
      },
    }
  )
} finally {
  console.error = originalError
}

console.log(
  "PASS  generation settlement owns terminal projection, empty-output failure, usage, preview, and initialization fallback"
)
