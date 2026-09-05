/** Thread Chat 新建树使用的公开默认模型。 */
export const DEFAULT_THREAD_CHAT_MODEL_ID = "openrouter-gpt-5.6-luna"

/** 客户端模型选项；只包含产品展示字段，不包含真实 provider 或上游模型信息。 */
export type ClientModelOption = {
  id: string
  name: string
  description?: string
  groupId: string
  groupName: string
}

/** Thread Chat 的公开模型 allowlist；服务端路由表不从这里派生。 */
export const THREAD_CHAT_MODEL_OPTIONS: readonly ClientModelOption[] = [
  {
    id: "iceland-claude-opus-4-6",
    name: "Claude Opus 4.6",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 Thinking",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-sonnet-4-6-thinking",
    name: "Claude Sonnet 4.6 Thinking",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-opus-4-7",
    name: "Claude Opus 4.7",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-opus-4-7-thinking",
    name: "Claude Opus 4.7 Thinking",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-fable-5",
    name: "Claude Fable 5",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-opus-5",
    name: "Claude Opus 5",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-sonnet-5",
    name: "Claude Sonnet 5",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-opus-4-8",
    name: "Claude Opus 4.8",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-opus-4-8-thinking",
    name: "Claude Opus 4.8 Thinking",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-grok-4.6",
    name: "Grok 4.6",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "iceland-gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    groupId: "group-d",
    groupName: "冰岛",
  },
  {
    id: "private-relay-gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "质量优先，适合复杂推理、复杂编码和专业工作。",
    groupId: "group-a",
    groupName: "塞班岛",
  },
  {
    id: "private-relay-gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "能力、延迟和配额消耗均衡，推荐用于日常复杂任务。",
    groupId: "group-a",
    groupName: "塞班岛",
  },
  {
    id: "private-relay-gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "面向高吞吐和低消耗任务的快速模型。",
    groupId: "group-a",
    groupName: "塞班岛",
  },
  {
    id: "private-relay-gpt-5.5",
    name: "GPT-5.5",
    description: "高能力通用模型，适合作为复杂工具型 Agent 的回退。",
    groupId: "group-a",
    groupName: "塞班岛",
  },
  {
    id: "private-relay-gpt-5.4",
    name: "GPT-5.4",
    description: "成熟的通用编码与专业工作模型，适合作为稳定回退。",
    groupId: "group-a",
    groupName: "塞班岛",
  },
  {
    id: "private-relay-gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    description: "面向高吞吐的快速模型，适合编码和子 Agent。",
    groupId: "group-a",
    groupName: "塞班岛",
  },
  {
    id: "private-relay-gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    description: "快速 Codex 编码模型；兼容性验证中。",
    groupId: "group-a",
    groupName: "塞班岛",
  },
  {
    id: "openrouter-gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-gpt-5.6-luna-pro",
    name: "GPT-5.6 Luna Pro",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-gpt-5.6-terra-pro",
    name: "GPT-5.6 Terra Pro",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-gpt-5.6-sol-pro",
    name: "GPT-5.6 Sol Pro",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-gpt-5.5",
    name: "GPT-5.5",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-gpt-5.5-pro",
    name: "GPT-5.5 Pro",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-kimi-k3",
    name: "Kimi K3",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash 0731",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-qwen3.8-max",
    name: "Qwen3.8 Max",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-grok-4.5",
    name: "Grok 4.5",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-grok-4.6",
    name: "Grok 4.6",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "openrouter-ox-alpha",
    name: "Ox Alpha",
    description: "面向编程与长时 Agent 任务的免费预览模型",
    groupId: "group-b",
    groupName: "巴厘岛",
  },
  {
    id: "doubao-seed-2.1-turbo",
    name: "Doubao Seed 2.1 Turbo",
    description: "Coding Plan",
    groupId: "group-c",
    groupName: "济州岛",
  },
  {
    id: "doubao-seed-2.0-lite",
    name: "Doubao Seed 2.0 Lite",
    description: "Coding Plan",
    groupId: "group-c",
    groupName: "济州岛",
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    description: "Coding Plan",
    groupId: "group-c",
    groupName: "济州岛",
  },
  {
    id: "glm-5.3",
    name: "GLM 5.3",
    description: "Coding Plan",
    groupId: "group-c",
    groupName: "济州岛",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description: "Coding Plan",
    groupId: "group-c",
    groupName: "济州岛",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "Coding Plan",
    groupId: "group-c",
    groupName: "济州岛",
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    description: "Coding Plan",
    groupId: "group-c",
    groupName: "济州岛",
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    description: "Coding Plan",
    groupId: "group-c",
    groupName: "济州岛",
  },
]
