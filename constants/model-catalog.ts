/** 可执行的兼容策略白名单；新增模型选择已有策略即可，无需新写代码。 */
export const MODEL_REQUEST_PROFILES = ["openai-chat", "gpt", "anthropic", "anthropic-adaptive", "deepseek", "glm", "thinking-required"] as const
export const MODEL_PROFILE_LABELS: Record<(typeof MODEL_REQUEST_PROFILES)[number], string> = {
  "openai-chat": "OpenAI Chat Completions",
  gpt: "GPT（max_completion_tokens）",
  anthropic: "Anthropic Messages",
  "anthropic-adaptive": "Anthropic 自适应思考",
  deepseek: "DeepSeek（可关闭思考）",
  glm: "GLM（始终思考、工具 auto）",
  "thinking-required": "始终思考（省略 tool_choice）",
}
export const MODEL_LOGOS = ["auto", "generic", "gpt", "claude", "gemini", "deepseek", "glm"] as const
export const MODEL_CATALOG_SETTINGS_ID = "global"
export const MODEL_CATALOG_REFRESH_MS = 30_000
export const MODEL_TOKEN_LIMIT = 16_000_000
