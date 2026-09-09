import assert from "node:assert/strict"
import { chatAnswerGenerationOptions } from "../../lib/thread-chat/streaming/generation-settings.ts"
import { generateText } from "ai"
import { resolveChatModelWithRoute } from "../../lib/ai/llm/providers.ts"
import { isTokenRouterConfigured, normalizeTokenRouterBaseURL } from "../../lib/ai/llm/token-router.ts"

// 拦截 SDK 最终请求，不调用付费服务。验证真实路由、协议、凭据和上游模型 ID。
const savedFetch = globalThis.fetch
const savedEnv = { ...process.env }
const requests = []
try {
  delete process.env.TOKEN_ROUTER_BASE_URL
  delete process.env.TOKEN_ROUTER_API_KEY
  process.env.PRIVATE_RELAY_API_KEY = "must-not-be-used"
  process.env.ICELAND_RELAY_API_KEY = "must-not-be-used"
  assert.equal(isTokenRouterConfigured(), false)
  assert.throws(() => normalizeTokenRouterBaseURL(), /未配置/)
  process.env.TOKEN_ROUTER_BASE_URL = "https://router.example.test///"
  assert.equal(isTokenRouterConfigured(), false)
  process.env.TOKEN_ROUTER_API_KEY = "router-test-key"
  assert.equal(isTokenRouterConfigured(), true)
  assert.equal(normalizeTokenRouterBaseURL(), "https://router.example.test/v1")
  assert.equal(normalizeTokenRouterBaseURL("https://router.example.test/v1/"), "https://router.example.test/v1")

  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) })
    const anthropic = String(url).endsWith("/messages")
    return Response.json(anthropic ? {
      id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-4-5",
      content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 8, output_tokens: 1 },
    } : {
      id: "chat_test", object: "chat.completion", created: 1, model: "gpt-5.6-luna",
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 },
    })
  }

  for (const id of ["private-relay-gpt-5.6-luna", "iceland-claude-haiku-4-5"]) {
    const resolved = resolveChatModelWithRoute(id)
    assert.equal(resolved.route.actualProvider, "token-router")
    const result = await generateText({ model: resolved.model, prompt: "Reply OK", maxOutputTokens: 8, maxRetries: 0 })
    assert.equal(result.text, "OK")
  }
  assert.equal(requests[0].body.max_completion_tokens, 8)
  assert.equal("max_tokens" in requests[0].body, false)
  assert.equal(requests[1].body.max_tokens, 8)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].url, "https://router.example.test/v1/chat/completions")
  assert.equal(requests[0].body.model, "gpt-5.6-luna")
  assert.equal(requests[0].headers.get("authorization"), "Bearer router-test-key")
  assert.equal(requests[1].url, "https://router.example.test/v1/messages")
  assert.equal(requests[1].body.model, "claude-haiku-4-5")
  assert.equal(requests[1].headers.get("x-api-key"), "router-test-key")
  for (const effort of ["none", "low", "max"]) {
    const resolved = resolveChatModelWithRoute("private-relay-gpt-5.6-luna")
    await generateText({ model: resolved.model, prompt: "Reply OK", maxRetries: 0,
      ...chatAnswerGenerationOptions("research", { effort, maxOutputTokens: 16_000 }, resolved.route.protocol) })
    const body = requests.at(-1).body
    assert.equal(body.reasoning_effort, effort)
    assert.equal(body.max_completion_tokens, 16_000)
    assert.equal("max_tokens" in body, false)
    assert.equal("thinking" in body, false)
  }
  const gemini = resolveChatModelWithRoute("iceland-gemini-3.7-flash")
  await generateText({ model: gemini.model, prompt: "Reply OK", maxOutputTokens: 8, maxRetries: 0 })
  assert.equal(requests.at(-1).body.max_tokens, 8)
  assert.equal("max_completion_tokens" in requests.at(-1).body, false)
  for (const upstreamId of [
    "deepseek-v4.1-flash-expires-on-0910",
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
    "deepseek-v4-pro",
    "glm-5.3",
    "glm-5.3-flash",
  ]) {
    const resolved = resolveChatModelWithRoute(`token-router-${upstreamId}`)
    assert.equal(resolved.route.protocol, "openai-compatible")
    await generateText({ model: resolved.model, prompt: "Reply OK", maxOutputTokens: 8, maxRetries: 0 })
    const request = requests.at(-1)
    assert.equal(request.url, "https://router.example.test/v1/chat/completions")
    assert.equal(request.body.model, upstreamId)
    assert.equal(request.body.max_tokens, 8)
    assert.equal("max_completion_tokens" in request.body, false)
    assert.equal("thinking" in request.body, false)
    assert.equal(request.headers.get("authorization"), "Bearer router-test-key")
  }
} finally {
  globalThis.fetch = savedFetch
  for (const name of ["TOKEN_ROUTER_BASE_URL", "TOKEN_ROUTER_API_KEY", "PRIVATE_RELAY_API_KEY", "ICELAND_RELAY_API_KEY"]) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
}
console.log("PASS Token Router 原生协议、统一凭据、稳定公开 ID 与真实请求体")
