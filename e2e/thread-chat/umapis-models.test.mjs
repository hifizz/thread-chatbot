/**
 * UMAPIS 模型注册与预览边界的纯验证：
 *   node --experimental-strip-types e2e/thread-chat/umapis-models.test.mjs
 */
import assert from "node:assert/strict"
import {
  CHAT_MODELS,
  THREAD_CHAT_MODELS,
  UMAPIS_MODEL_IDS,
  getChatModel,
  isUnbilledPreviewModel,
} from "../../constants/model.ts"
import { MODEL_COST } from "../../constants/pricing.ts"
import {
  DEFAULT_UMAPIS_BASE_URL,
  getUMAPISApiKey,
  isUMAPISConfigured,
  normalizeUMAPISBaseURL,
} from "../../lib/ai/umapis.ts"

const expectedModels = [
  ["claude-opus-4-6", "claude"],
  ["claude-opus-4-6-thinking", "claude"],
  ["claude-sonnet-4-6", "claude"],
  ["claude-sonnet-4-6-thinking", "claude"],
  ["claude-opus-4-7", "claude"],
  ["claude-opus-4-7-thinking", "claude"],
  ["claude-fable-5", "claude"],
  ["claude-opus-5", "claude"],
  ["claude-sonnet-5", "claude"],
  ["claude-opus-4-8", "claude"],
  ["claude-opus-4-8-thinking", "claude"],
  ["claude-haiku-4-5", "claude"],
  ["gemini-3.7-flash", "claude"],
  ["grok-4.6", "claude"],
  ["gpt-5.6-sol", "gpt"],
  ["gpt-5.6-terra", "gpt"],
]
const models = CHAT_MODELS.filter((model) => model.provider === "umapis")

assert.equal(models.length, expectedModels.length)
assert.deepEqual(
  [...UMAPIS_MODEL_IDS],
  expectedModels.map(([id]) => id)
)
assert.deepEqual(
  models.map((model) => [model.upstreamModel, model.umapisCredentialGroup]),
  expectedModels
)
assert.ok(models.every((model) => model.id.startsWith("umapis-")))
assert.ok(models.every((model) => model.name.startsWith("UMAPIS · ")))
assert.ok(models.every((model) => model.unbilledPreview === true))
assert.ok(models.every((model) => THREAD_CHAT_MODELS.includes(model)))
assert.ok(models.every((model) => !MODEL_COST[model.id]))
assert.ok(models.every(isUnbilledPreviewModel))
assert.equal(isUnbilledPreviewModel(getChatModel("glm-5.3")), false)
assert.equal(
  normalizeUMAPISBaseURL("https://www.umapis.com"),
  DEFAULT_UMAPIS_BASE_URL
)
assert.equal(
  normalizeUMAPISBaseURL("https://example.test/proxy/v1/"),
  "https://example.test/proxy/v1"
)
assert.equal(normalizeUMAPISBaseURL(""), DEFAULT_UMAPIS_BASE_URL)

const originalClaudeKey = process.env.UMAPIS_API_KEY_CLAUDE
const originalGptKey = process.env.UMAPIS_API_KEY_GPT
try {
  process.env.UMAPIS_API_KEY_CLAUDE = " claude-test-key "
  process.env.UMAPIS_API_KEY_GPT = " gpt-test-key "
  assert.equal(getUMAPISApiKey("claude"), "claude-test-key")
  assert.equal(getUMAPISApiKey("gpt"), "gpt-test-key")
  assert.equal(isUMAPISConfigured("claude"), true)
  assert.equal(isUMAPISConfigured("gpt"), true)

  delete process.env.UMAPIS_API_KEY_GPT
  assert.equal(isUMAPISConfigured("gpt"), false)
  assert.equal(isUMAPISConfigured("claude"), true)
} finally {
  if (originalClaudeKey === undefined) delete process.env.UMAPIS_API_KEY_CLAUDE
  else process.env.UMAPIS_API_KEY_CLAUDE = originalClaudeKey
  if (originalGptKey === undefined) delete process.env.UMAPIS_API_KEY_GPT
  else process.env.UMAPIS_API_KEY_GPT = originalGptKey
}

console.log("PASS  UMAPIS 注册、凭据分组、Prompt 输入可见性与未计费预览边界")
