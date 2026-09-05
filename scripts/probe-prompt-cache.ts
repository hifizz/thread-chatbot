import { generateText } from "ai"
import { resolveChatModelWithRoute } from "@/lib/ai/llm/model-routes"
import { decoratePromptCache } from "@/lib/thread-chat/streaming/prompt-cache-decorator"

// 手动运行的付费验证；不加入 CI。只打印非敏感用量，不输出请求或响应正文。
const fetchOriginal = globalThis.fetch
let rawUsage: Record<string, number> | undefined
globalThis.fetch = async (...args) => {
  const response = await fetchOriginal(...args)
  if (response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => null)
    if (body?.usage) {
      rawUsage = Object.fromEntries(
        [
          "input_tokens",
          "output_tokens",
          "cache_read_input_tokens",
          "cache_creation_input_tokens",
        ]
          .filter((key) => typeof body.usage[key] === "number")
          .map((key) => [key, body.usage[key]])
      )
    }
  }
  return response
}

try {
  for (const modelId of ["iceland-claude-opus-5", "iceland-claude-sonnet-5"]) {
    const experimentId = crypto.randomUUID()
    const prefix =
      `Synthetic cache verification ${experimentId}. Ignore the records; reply OK.\n` +
      Array.from(
        { length: 1100 },
        (_, index) =>
          `Record ${index}: alpha beta gamma delta epsilon zeta eta theta.`
      ).join("\n")
    const resolved = resolveChatModelWithRoute(modelId)
    const prompt = decoratePromptCache({
      instructions: [{ role: "system", content: prefix }],
      messages: [{ role: "user", content: "Reply OK only." }],
      boundaries: {
        stableInstructionsEnd: true,
        stableHistoryMessageIndex: null,
      },
      policy: { explicitCacheEnabled: true },
    })
    for (let attempt = 1; attempt <= 2; attempt++) {
      rawUsage = undefined
      const started = Date.now()
      try {
        const result = await generateText({
          model: resolved.model,
          instructions: prompt.instructions,
          messages: prompt.messages,
          reasoning: "none",
          maxOutputTokens: 16,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(60_000),
        })
        console.log(
          JSON.stringify({
            time: new Date().toISOString(),
            experimentId,
            modelId,
            route: resolved.route,
            attempt,
            durationMs: Date.now() - started,
            prefixChars: prefix.length,
            inputTokens: result.usage.inputTokens,
            inputTokenDetails: result.usage.inputTokenDetails,
            outputTokens: result.usage.outputTokens,
            finishReason: result.finishReason,
            rawUsage,
          })
        )
      } catch (error) {
        console.log(
          JSON.stringify({
            time: new Date().toISOString(),
            experimentId,
            modelId,
            attempt,
            error: error instanceof Error ? error.name : "UnknownError",
            statusCode:
              typeof error === "object" &&
              error !== null &&
              "statusCode" in error
                ? error.statusCode
                : undefined,
          })
        )
        break
      }
    }
  }
} finally {
  globalThis.fetch = fetchOriginal
}
