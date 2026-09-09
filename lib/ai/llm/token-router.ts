import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { tokenRouterModels } from "@/constants/models/token-router"
import { createModels } from "@/lib/ai/llm/create-models"

export function normalizeTokenRouterBaseURL(
  baseURL: string | undefined = process.env.TOKEN_ROUTER_BASE_URL
): string {
  const configured = baseURL?.trim()
  if (!configured) throw new Error("Token Router 未配置 Base URL")
  const normalized = configured.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

export function isTokenRouterConfigured(): boolean {
  return Boolean(
    process.env.TOKEN_ROUTER_BASE_URL?.trim() &&
    process.env.TOKEN_ROUTER_API_KEY?.trim()
  )
}

function protocol(modelId: string) {
  return modelId.startsWith("claude-") ? "anthropic" : "openai-compatible"
}

/** 在发送前适配模型差异；不改变其他渠道、模型或历史消息。 */
export function normalizeTokenRouterRequest(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.model !== "string") return body
  if (body.model.startsWith("gpt-")) {
    const { max_tokens, ...rest } = body
    return { ...rest, ...(max_tokens !== undefined ? { max_completion_tokens: max_tokens } : {}) }
  }
  const model = tokenRouterModels.models.find((entry) => entry.id === body.model)
  if (!model || !("requestPolicy" in model)) return body
  const policy = model.requestPolicy
  const { tool_choice, reasoning_effort, thinking, ...rest } = body
  const thinkingOptions = typeof thinking === "object" && thinking !== null ? thinking : {}
  const disabled = policy.thinking === "optional" &&
    (reasoning_effort === "none" || (reasoning_effort === undefined && "type" in thinkingOptions && thinkingOptions.type === "disabled"))
  const effort = reasoning_effort === "none" ? "low"
    : reasoning_effort === "medium" ? "high"
    : reasoning_effort === "xhigh" ? "max"
    : reasoning_effort ?? "high"
  if (!["low", "high", "max"].includes(String(effort))) {
    throw new Error(`模型 ${body.model} 不支持推理强度 ${String(effort)}`)
  }
  const normalized: Record<string, unknown> = {
    ...rest,
    thinking: { ...thinkingOptions, type: disabled ? "disabled" : "enabled" },
    ...(!disabled ? { reasoning_effort: effort } : {}),
  }
  // 禁止工具时必须同时移除 tools，不能因省略 tool_choice 重新允许工具调用。
  if (tool_choice === "none") {
    delete normalized.tools
    return normalized
  }
  // 保留指定工具的范围；auto 仍允许模型直接回答，不等价于保证工具执行。
  if (typeof tool_choice === "object" && tool_choice !== null && "function" in tool_choice) {
    const selected = tool_choice.function
    if (typeof selected === "object" && selected !== null && "name" in selected && Array.isArray(normalized.tools)) {
      const selectedTools = normalized.tools.filter((tool) => tool.function?.name === selected.name)
      if (selectedTools.length === 0) throw new Error("指定的工具不在当前可用工具列表中")
      normalized.tools = selectedTools
    }
  }
  if (policy.toolChoice === "auto" && Array.isArray(normalized.tools) && normalized.tools.length > 0) {
    normalized.tool_choice = "auto"
  }
  return normalized
}

/** 一个中转服务、一组凭据；按模型族保留对应的原生请求协议。 */
export const tokenRouterModelProvider = createModels({
  models: tokenRouterModels,
  routeIdentity: (model) => ({
    actualProvider: tokenRouterModels.id,
    protocol: protocol(model.id),
    upstreamModel: model.id,
  }),
  isConfigured: isTokenRouterConfigured,
  createProvider: () => {
    const baseURL = normalizeTokenRouterBaseURL()
    const apiKey = process.env.TOKEN_ROUTER_API_KEY?.trim()
    if (!apiKey) throw new Error("Token Router 未配置 API Key")
    const anthropic = createAnthropic({
      name: `${tokenRouterModels.id}-anthropic`, baseURL, apiKey,
    })
    const openai = createOpenAICompatible({
      name: tokenRouterModels.id, baseURL, apiKey, includeUsage: true,
      transformRequestBody: normalizeTokenRouterRequest,
    })
    return (model) => protocol(model.id) === "anthropic"
      ? anthropic(model.id)
      : openai(model.id)
  },
})
