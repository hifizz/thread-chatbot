import type { ModelDefinition } from "@/constants/models/types"

type RequestOptions = {
  completionTokens?: boolean
  policy?: ModelDefinition["requestPolicy"]
  toolCalling?: boolean
  defaultEffort?: string
}
/** 静态兼容路由与数据库路由共用的纯转换；绝不修改消息历史或原始请求。 */
export function normalizeTokenRouterBody(body: Record<string, unknown>, options: RequestOptions): Record<string, unknown> {
  let input = { ...body }
  if (options.toolCalling === false) {
    delete input.tools
    delete input.tool_choice
    delete input.parallel_tool_calls
  }
  if (options.completionTokens) {
    const { max_tokens, ...rest } = input
    input = { ...rest, ...(max_tokens !== undefined ? { max_completion_tokens: max_tokens } : {}) }
  }
  const policy = options.policy
  if (!policy) return input
  const { tool_choice, reasoning_effort, thinking, ...rest } = input
  const thinkingOptions = typeof thinking === "object" && thinking !== null ? thinking : {}
  const requestedEffort = reasoning_effort ?? options.defaultEffort
  const disabled = policy.thinking === "optional" && (requestedEffort === "none" || (requestedEffort === undefined && "type" in thinkingOptions && thinkingOptions.type === "disabled"))
  const effort = requestedEffort === "none" ? "low" : requestedEffort === "medium" ? "high" : requestedEffort === "xhigh" ? "max" : requestedEffort ?? "high"
  if (!["low", "high", "max"].includes(String(effort))) throw new Error(`模型 ${body.model} 不支持推理强度 ${String(effort)}`)
  const normalized: Record<string, unknown> = { ...rest, thinking: { ...thinkingOptions, type: disabled ? "disabled" : "enabled" }, ...(!disabled ? { reasoning_effort: effort } : {}) }
  if (tool_choice === "none") { delete normalized.tools; return normalized }
  if (typeof tool_choice === "object" && tool_choice !== null && "function" in tool_choice) {
    const selected = tool_choice.function
    if (typeof selected === "object" && selected !== null && "name" in selected && Array.isArray(normalized.tools)) {
      const selectedTools = normalized.tools.filter((tool) => tool.function?.name === selected.name)
      if (!selectedTools.length) throw new Error("指定的工具不在当前可用工具列表中")
      normalized.tools = selectedTools
    }
  }
  if (policy.toolChoice === "auto" && Array.isArray(normalized.tools) && normalized.tools.length > 0) normalized.tool_choice = "auto"
  return normalized
}
