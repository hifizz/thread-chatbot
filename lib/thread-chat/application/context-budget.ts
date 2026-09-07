/** Token 计量不可用时必须返回 unknown，不能拿字符数当作 token。 */
export function evaluateContextBudget(input: {
  inputTokens: number | null
  contextWindow: number | null
  outputTokens: number
}) {
  if (input.inputTokens === null || input.contextWindow === null)
    return { status: "unknown" as const, reason: "模型未提供完整请求计量或上下文上限", outputTokens: input.outputTokens }
  const totalTokens = input.inputTokens + input.outputTokens
  return { status: totalTokens > input.contextWindow ? "exceeded" as const : "within" as const, totalTokens, contextWindow: input.contextWindow }
}

export function contextLimitFailure(error: unknown): { code: string; message: string } | null {
  const visited = new Set<unknown>()
  function matches(value: unknown): boolean {
    if (!value || visited.has(value)) return false
    if (typeof value === "string") return /context_length_exceeded|maximum context length|context window|prompt is too long|input is too long/i.test(value)
    if (typeof value !== "object") return false
    visited.add(value)
    const record = value as Record<string, unknown>
    return [record.code, record.message, record.cause, record.error, record.responseBody].some(matches)
  }
  return matches(error) ? { code: "CONTEXT_LIMIT_EXCEEDED", message: "上下文超过模型限制，请减少附件或引用，或开启新对话。" } : null
}
