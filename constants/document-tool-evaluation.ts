/** 专项工具行为评测：同一模型的旧/新协议使用完全相同的题集和生成预算。 */
export const DOCUMENT_TOOL_EVALUATION = {
  baselineCommit: "142e6a7911509e9aa336fa58fc0aa1555971c852",
  experimentName: "project-document-tool-routing",
  evaluatorVersion: "document-tool-facts-v1",
  contextPolicy: "synthetic-tool-simulation-v1",
  repeats: 3,
  maxRepeats: 20,
  maxSteps: 12,
  maxOutputTokens: 3000,
  timeoutMs: 120_000,
  models: ["private-relay-gpt-5.6-luna", "private-relay-gpt-6-astra", "iceland-claude-opus-5"],
} as const
