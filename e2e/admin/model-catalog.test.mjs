import assert from "node:assert/strict"
import { generateText } from "ai"
import { modelCatalogConfigSchema } from "../../lib/model-catalog/schema.ts"
import { toPublicCatalogModel } from "../../lib/model-catalog/public.ts"
import { resolveGenerationSettings } from "../../lib/thread-chat/generation-settings.ts"
import { chatAnswerGenerationOptions } from "../../lib/thread-chat/streaming/generation-settings.ts"
import { normalizeCatalogRequest, resolveCatalogLanguageModel } from "../../lib/model-catalog/runtime.ts"
import { assertGenerationSettingsCapability, assertImageInputCapability } from "../../lib/model-catalog/validation.ts"
import { assertAdminWriteRequest } from "../../lib/admin/http.ts"
const adminRequest = (origin, contentType = "application/json") => new Request("http://localhost:3000/api/admin/models", { headers: { host: "127.0.0.1:3000", origin, "content-type": contentType } })
assert.doesNotThrow(() => assertAdminWriteRequest(adminRequest("http://127.0.0.1:3000")))
assert.throws(() => assertAdminWriteRequest(adminRequest("https://foreign.test")), (e) => e.status === 403)
assert.throws(() => assertAdminWriteRequest(adminRequest("http://127.0.0.1:3000", "text/plain")), (e) => e.status === 415)
const config = {
  name: "测试模型", description: "", upstreamId: "new-model-not-in-source", logo: "generic", profile: "openai-chat", contextWindow: 128000,
  imageInput: false, toolCalling: false, reasoning: false, effortLevels: [], defaultEffort: null,
  maxOutputTokens: 8192, outputTokenOptions: [2048, 8192], defaultMaxOutputTokens: 2048,
}
assert(modelCatalogConfigSchema.safeParse(config).success)
for (const change of [
  { defaultMaxOutputTokens: 3000 }, { maxOutputTokens: 1024 }, { defaultEffort: "high" },
  { outputTokenOptions: [2048, 2048] }, { profile: "unknown" }, { contextWindow: 1024 },
  { apiKey: "must-reject" }, { baseURL: "https://evil.test" },
  { profile: "glm", reasoning: true, effortLevels: ["none", "high"], defaultEffort: "high" },
]) assert.equal(modelCatalogConfigSchema.safeParse({ ...config, ...change }).success, false, JSON.stringify(change))
const snapshot = { id: "new-public-id", enabled: true, version: 1, sortOrder: 0, config }
const publicModel = toPublicCatalogModel(snapshot)
assert.equal(JSON.stringify(publicModel).includes(config.upstreamId), false)
assert.equal("profile" in publicModel, false)
const settings = resolveGenerationSettings(snapshot.id, undefined, publicModel.capabilities.generationSettings)
assert.deepEqual(settings, { maxOutputTokens: 2048 })
assert.deepEqual(chatAnswerGenerationOptions("answer", settings, "openai-compatible"), { maxOutputTokens: 2048 })
assert.throws(() => assertGenerationSettingsCapability(publicModel.capabilities.generationSettings, { effort: "high", maxOutputTokens: 2048 }))
assert.throws(() => assertImageInputCapability(false, 1))
assert.throws(() => assertImageInputCapability(true, 100))
const changed = { ...snapshot, version: 2, config: { ...config, reasoning: true, effortLevels: ["low", "high"], defaultEffort: "low", defaultMaxOutputTokens: 8192 } }
assert.deepEqual(resolveGenerationSettings(changed.id, undefined, toPublicCatalogModel(changed).capabilities.generationSettings), { effort: "low", maxOutputTokens: 8192 })
assert.deepEqual(resolveGenerationSettings(changed.id, { effort: "max", maxOutputTokens: 9999 }, toPublicCatalogModel(changed).capabilities.generationSettings), { effort: "low", maxOutputTokens: 8192 })
assert.deepEqual(normalizeCatalogRequest({ model: config.upstreamId, tools: [{}], tool_choice: "auto" }, snapshot), { model: config.upstreamId })

assert.equal(normalizeCatalogRequest({}, { ...snapshot, config: { ...config, profile: "deepseek", defaultEffort: "none" } }).thinking.type, "disabled", "默认 none 即使没有显式参数也必须关闭思考")

const originalFetch = globalThis.fetch
const oldBase = process.env.TOKEN_ROUTER_BASE_URL
const oldKey = process.env.TOKEN_ROUTER_API_KEY
process.env.TOKEN_ROUTER_BASE_URL = "https://catalog-router.example.test"
process.env.TOKEN_ROUTER_API_KEY = "fixture"
const requests = []
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), body: JSON.parse(init.body) })
  return Response.json(String(url).endsWith("/messages") ? {
    id: "m", type: "message", role: "assistant", model: "fixture", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  } : { id: "c", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
}
try {
  for (const [profile, effort] of [["openai-chat", null], ["gpt", "low"], ["glm", "high"], ["deepseek", "none"], ["anthropic", null], ["anthropic-adaptive", "high"]]) {
    const model = { ...snapshot, config: { ...config, profile, reasoning: effort !== null, effortLevels: effort ? [effort] : [], defaultEffort: effort } }
    const resolved = resolveCatalogLanguageModel(model)
    const options = chatAnswerGenerationOptions("answer", resolveGenerationSettings(model.id, undefined, toPublicCatalogModel(model).capabilities.generationSettings), resolved.route.protocol)
    assert.equal((await generateText({ model: resolved.model, prompt: "OK", maxRetries: 0, ...options })).text, "OK")
    const { body, url } = requests.at(-1)
    assert.equal(body.model, config.upstreamId)
    assert.equal(body[profile === "gpt" ? "max_completion_tokens" : "max_tokens"], 2048)
    if (!effort) { assert.equal(body.reasoning_effort, undefined); assert.equal(body.thinking, undefined) }
    if (profile === "deepseek") { assert.equal(body.thinking.type, "disabled"); assert.equal(body.reasoning_effort, undefined) }
    if (profile === "glm") assert.equal(body.reasoning_effort, "high")
    if (profile.startsWith("anthropic")) assert(url.endsWith("/messages"))
    else assert(url.endsWith("/chat/completions"))
  }
} finally {
  globalThis.fetch = originalFetch
  if (oldBase === undefined) delete process.env.TOKEN_ROUTER_BASE_URL; else process.env.TOKEN_ROUTER_BASE_URL = oldBase
  if (oldKey === undefined) delete process.env.TOKEN_ROUTER_API_KEY; else process.env.TOKEN_ROUTER_API_KEY = oldKey
}
console.log("PASS 目录校验、公开字段、默认参数、能力门禁及六种真实 SDK 请求序列化（模拟上游）")
