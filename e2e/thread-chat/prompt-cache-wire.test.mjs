import assert from "node:assert/strict"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"
import { decoratePromptCache } from "../../lib/thread-chat/streaming/prompt-cache-decorator.ts"

// 只拦截 SDK 发出的请求，不访问中继，也不调用付费模型。
const requests = []
const provider = createAnthropic({
  apiKey: "test-only",
  baseURL: "https://relay.example.test/v1",
  fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    })
  },
})

for (const enabled of [false, true]) {
  const prompt = decoratePromptCache({
    instructions: [{ role: "system", content: "固定的服务端指令" }],
    messages: [
      { role: "user", content: "历史问题" },
      { role: "assistant", content: "历史回答" },
      { role: "user", content: "当前问题" },
    ],
    boundaries: { stableInstructionsEnd: true, stableHistoryMessageIndex: 1 },
    policy: { explicitCacheEnabled: enabled },
  })
  await generateText({
    model: provider("claude-opus-5"),
    instructions: prompt.instructions,
    messages: prompt.messages,
    maxOutputTokens: 32_000,
    providerOptions: {
      anthropic: {
        effort: "high",
        thinking: { type: "adaptive", display: "summarized" },
      },
    },
  })
}

const [disabled, enabled] = requests
assert.equal(JSON.stringify(disabled).includes("cache_control"), false)
assert.deepEqual(enabled.system[0].cache_control, {
  type: "ephemeral",
  ttl: "5m",
})
assert.deepEqual(enabled.messages[1].content.at(-1).cache_control, {
  type: "ephemeral",
  ttl: "5m",
})
assert.equal(
  JSON.stringify(enabled.messages[2]).includes("cache_control"),
  false
)
function withoutCacheControl(value) {
  return JSON.parse(
    JSON.stringify(value, (key, item) =>
      key === "cache_control" ? undefined : item
    )
  )
}
assert.deepEqual(withoutCacheControl(enabled), disabled)
assert.equal(enabled.max_tokens, 32_000)
assert.equal(enabled.output_config.effort, "high")
assert.deepEqual(enabled.thinking, { type: "adaptive", display: "summarized" })
console.log("PASS Anthropic 缓存参数序列化及生成参数不变性（无网络）")
