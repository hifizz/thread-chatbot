import assert from "node:assert/strict"
import { evaluateContextBudget, contextLimitFailure } from "../../lib/thread-chat/application/context-budget.ts"
assert.equal(evaluateContextBudget({ inputTokens: 90, outputTokens: 10, contextWindow: 100 }).status, "within")
assert.equal(evaluateContextBudget({ inputTokens: 91, outputTokens: 10, contextWindow: 100 }).status, "exceeded")
for (const input of [{ inputTokens: null, contextWindow: 100 }, { inputTokens: 100, contextWindow: null }])
  assert.equal(evaluateContextBudget({ ...input, outputTokens: 10 }).status, "unknown")
for (const error of [new Error("maximum context length"), { cause: { responseBody: '{"error":{"code":"context_length_exceeded"}}' } }, { error: { message: "prompt is too long" } }])
  assert.equal(contextLimitFailure(error)?.code, "CONTEXT_LIMIT_EXCEEDED")
const circular = {}; circular.cause = circular
assert.equal(contextLimitFailure(circular), null)
assert.equal(contextLimitFailure(new Error("network unavailable")), null)
console.log("PASS 上下文预算：输出预留、边界、未知计量、嵌套提供商错误与循环保护")
