// 对话模型注册表（单一事实来源）。
// id 在全站统一使用：输入框选择器、计费定价（constants/pricing.ts 的 key）、
// 服务端 provider 解析（lib/ai/provider.ts）。

export const OPENROUTER_MODEL_IDS = [
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-luna-pro",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-terra-pro",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-sol-pro",
  "openai/gpt-5.5",
  "openai/gpt-5.5-pro",
  "moonshotai/kimi-k3",
  "deepseek/deepseek-v4-flash-0731",
  "qwen/qwen3.8-max",
  "x-ai/grok-4.5",
  "x-ai/grok-4.6",
] as const

export type OpenRouterModelId = (typeof OPENROUTER_MODEL_IDS)[number]
export const UMAPIS_CLAUDE_MODEL_IDS = [
  "claude-opus-4-6",
  "claude-opus-4-6-thinking",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6-thinking",
  "claude-opus-4-7",
  "claude-opus-4-7-thinking",
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-8-thinking",
  "claude-haiku-4-5",
  "gemini-3.7-flash",
  "grok-4.6",
] as const

export type UMAPISClaudeModelId = (typeof UMAPIS_CLAUDE_MODEL_IDS)[number]

export const UMAPIS_MODEL_IDS = [
  ...UMAPIS_CLAUDE_MODEL_IDS,
  "gpt-5.6-sol",
  "gpt-5.6-terra",
] as const

export type UMAPISModelId = (typeof UMAPIS_MODEL_IDS)[number]
export type UMAPISCredentialGroup = "claude" | "gpt"
export type ChatModelProvider =
  "minimax" | "deepseek" | "openai" | "ark" | "openrouter" | "umapis"
export type ReasoningTransport = "think-tags" | "native"
export type ChatModelSurface = "linear" | "thread"

export type ChatModel = {
  /** 注册表 id，全站唯一标识 */
  id: string
  /** 展示名 */
  name: string
  /** 展示描述 */
  description?: string
  /** 归属供应商 */
  provider: ChatModelProvider
  /** 供应商原生模型名（直连或作为网关上游模型名） */
  upstreamModel: string
  /**
   * 经 Cloudflare AI 网关 compat 端点时的模型标识："provider/model"。
   * MiniMax 不在 CF 网关支持列表中，故为空 → 走直连。
   */
  gatewayModel?: string
  /** 推理传输方式；只有 think-tags 需要标签抽取中间件。 */
  reasoningTransport?: ReasoningTransport
  /** UMAPIS 模型使用的服务端凭据组。 */
  umapisCredentialGroup?: UMAPISCredentialGroup
  /** 尚未定义价格与扣费策略的模型，只保留可用 token usage。 */
  unbilledPreview?: true
  /** 模型可见的产品入口。 */
  surfaces: readonly ChatModelSurface[]
  /** 仅用于展示分组，不参与鉴权和路由。 */
  creator?: "anthropic" | "openai" | "moonshotai" | "deepseek" | "qwen" | "x-ai"
}

/** 用统一的 Claude 组配置注册 UMAPIS 未计费预览模型。 */
function createUmapisClaudeModel<const TModelId extends UMAPISClaudeModelId>(
  upstreamModel: TModelId,
  name: string
) {
  return {
    id: `umapis-${upstreamModel}` as const,
    name: `UMAPIS · ${name}`,
    description: "UMAPIS 预览（Claude 组）",
    provider: "umapis",
    upstreamModel,
    reasoningTransport: "native",
    umapisCredentialGroup: "claude",
    unbilledPreview: true,
    surfaces: ["thread"],
    creator: "anthropic",
  } as const satisfies ChatModel
}

const CHAT_MODEL_REGISTRY = [
  {
    id: "minimax-m2",
    name: "MiniMax M2",
    description: "通用对话模型（直连）",
    provider: "minimax",
    upstreamModel: "MiniMax-M2",
    reasoningTransport: "think-tags",
    surfaces: ["linear"],
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek V3.2",
    description: "高性价比通用模型（经 CF AI 网关）",
    provider: "deepseek",
    upstreamModel: "deepseek-chat",
    gatewayModel: "deepseek/deepseek-chat",
    surfaces: ["linear"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    description: "OpenAI 轻量模型（经 CF AI 网关）",
    provider: "openai",
    upstreamModel: "gpt-4o-mini",
    gatewayModel: "openai/gpt-4o-mini",
    surfaces: ["linear"],
  },
  {
    id: "doubao-seed-2.1-turbo",
    name: "Doubao Seed 2.1 Turbo",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "doubao-seed-2.1-turbo",
    surfaces: ["linear", "thread"],
  },
  {
    id: "doubao-seed-2.0-lite",
    name: "Doubao Seed 2.0 Lite",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "doubao-seed-2.0-lite",
    surfaces: ["linear", "thread"],
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "minimax-m2.7",
    surfaces: ["linear"],
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "minimax-m3",
    surfaces: ["linear", "thread"],
  },
  {
    id: "glm-5.3",
    name: "glm-5.3",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "glm-5.3",
    surfaces: ["linear", "thread"],
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "deepseek-v4-flash",
    surfaces: ["linear", "thread"],
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "deepseek-v4-pro",
    surfaces: ["linear", "thread"],
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "kimi-k2.6",
    surfaces: ["linear", "thread"],
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "kimi-k2.7-code",
    surfaces: ["linear", "thread"],
  },
  createUmapisClaudeModel("claude-opus-4-6", "Claude Opus 4.6"),
  createUmapisClaudeModel(
    "claude-opus-4-6-thinking",
    "Claude Opus 4.6 Thinking"
  ),
  createUmapisClaudeModel("claude-sonnet-4-6", "Claude Sonnet 4.6"),
  createUmapisClaudeModel(
    "claude-sonnet-4-6-thinking",
    "Claude Sonnet 4.6 Thinking"
  ),
  createUmapisClaudeModel("claude-opus-4-7", "Claude Opus 4.7"),
  createUmapisClaudeModel(
    "claude-opus-4-7-thinking",
    "Claude Opus 4.7 Thinking"
  ),
  createUmapisClaudeModel("claude-fable-5", "Claude Fable 5"),
  createUmapisClaudeModel("claude-opus-5", "Claude Opus 5"),
  createUmapisClaudeModel("claude-sonnet-5", "Claude Sonnet 5"),
  createUmapisClaudeModel("claude-opus-4-8", "Claude Opus 4.8"),
  createUmapisClaudeModel(
    "claude-opus-4-8-thinking",
    "Claude Opus 4.8 Thinking"
  ),
  createUmapisClaudeModel("claude-haiku-4-5", "Claude Haiku 4.5"),
  createUmapisClaudeModel("gemini-3.7-flash", "Gemini 3.7 Flash"),
  createUmapisClaudeModel("grok-4.6", "Grok 4.6"),
  {
    id: "umapis-gpt-5.6-sol",
    name: "UMAPIS · GPT-5.6 Sol",
    description: "UMAPIS 预览（GPT 组）",
    provider: "umapis",
    upstreamModel: "gpt-5.6-sol",
    reasoningTransport: "native",
    umapisCredentialGroup: "gpt",
    unbilledPreview: true,
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "umapis-gpt-5.6-terra",
    name: "UMAPIS · GPT-5.6 Terra",
    description: "UMAPIS 预览（GPT 组）",
    provider: "umapis",
    upstreamModel: "gpt-5.6-terra",
    reasoningTransport: "native",
    umapisCredentialGroup: "gpt",
    unbilledPreview: true,
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-gpt-5.6-luna",
    name: "OpenRouter · GPT-5.6 Luna",
    provider: "openrouter",
    upstreamModel: "openai/gpt-5.6-luna",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-gpt-5.6-luna-pro",
    name: "OpenRouter · GPT-5.6 Luna Pro",
    provider: "openrouter",
    upstreamModel: "openai/gpt-5.6-luna-pro",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-gpt-5.6-terra",
    name: "OpenRouter · GPT-5.6 Terra",
    provider: "openrouter",
    upstreamModel: "openai/gpt-5.6-terra",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-gpt-5.6-terra-pro",
    name: "OpenRouter · GPT-5.6 Terra Pro",
    provider: "openrouter",
    upstreamModel: "openai/gpt-5.6-terra-pro",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-gpt-5.6-sol",
    name: "OpenRouter · GPT-5.6 Sol",
    provider: "openrouter",
    upstreamModel: "openai/gpt-5.6-sol",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-gpt-5.6-sol-pro",
    name: "OpenRouter · GPT-5.6 Sol Pro",
    provider: "openrouter",
    upstreamModel: "openai/gpt-5.6-sol-pro",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-gpt-5.5",
    name: "OpenRouter · GPT-5.5",
    provider: "openrouter",
    upstreamModel: "openai/gpt-5.5",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-gpt-5.5-pro",
    name: "OpenRouter · GPT-5.5 Pro",
    provider: "openrouter",
    upstreamModel: "openai/gpt-5.5-pro",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "openai",
  },
  {
    id: "openrouter-kimi-k3",
    name: "OpenRouter · Kimi K3",
    provider: "openrouter",
    upstreamModel: "moonshotai/kimi-k3",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "moonshotai",
  },
  {
    id: "openrouter-deepseek-v4-flash-0731",
    name: "OpenRouter · DeepSeek V4 Flash 0731",
    provider: "openrouter",
    upstreamModel: "deepseek/deepseek-v4-flash-0731",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "deepseek",
  },
  {
    id: "openrouter-qwen3.8-max",
    name: "OpenRouter · Qwen3.8 Max",
    provider: "openrouter",
    upstreamModel: "qwen/qwen3.8-max",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "qwen",
  },
  {
    id: "openrouter-grok-4.5",
    name: "OpenRouter · Grok 4.5",
    provider: "openrouter",
    upstreamModel: "x-ai/grok-4.5",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "x-ai",
  },
  {
    id: "openrouter-grok-4.6",
    name: "OpenRouter · Grok 4.6",
    provider: "openrouter",
    upstreamModel: "x-ai/grok-4.6",
    reasoningTransport: "native",
    surfaces: ["thread"],
    creator: "x-ai",
  },
] as const satisfies readonly ChatModel[]

export type ChatModelEntry = (typeof CHAT_MODEL_REGISTRY)[number]
export type ChatModelId = ChatModelEntry["id"]

/** 运行时消费者使用宽化视图；字面量 registry 只负责派生精确 id 联合。 */
export const CHAT_MODELS: readonly ChatModel[] = CHAT_MODEL_REGISTRY

export const DEFAULT_MODEL_ID: ChatModelId = "minimax-m2"

/** 从注册表的产品可见面派生 Thread Chat 选项。 */
export const THREAD_CHAT_MODELS: readonly ChatModel[] = CHAT_MODELS.filter(
  (model) => model.surfaces.includes("thread")
)

/** Thread Chat 新建树及旧树模型回退使用的默认模型。 */
export const DEFAULT_THREAD_CHAT_MODEL_ID: ChatModelId =
  "umapis-claude-opus-4-6"

/**
 * 单次生成的输出 token 上限（安全阀）。
 * 作用：① 封顶单请求成本，收敛「并发扣费竞态」下的最大超支敞口（后付费模型）；
 * ② 防止异常长输出打爆供应商账单。研究模式多步循环时对「每步」输出生效。
 * 可按业务放宽/收紧。
 */
export const MAX_OUTPUT_TOKENS = 8192

export function getChatModel(id: string | undefined): ChatModel | undefined {
  return CHAT_MODELS.find((m) => m.id === id)
}

/** 未定义价格和额度策略的模型仅作为不扣费预览提供。 */
export function isUnbilledPreviewModel(model: ChatModel): boolean {
  return model.unbilledPreview === true
}

export function isChatModelId(id: unknown): id is ChatModelId {
  return typeof id === "string" && getChatModel(id) !== undefined
}

/** Thread Chat 允许写入 Thread 的模型 id。 */
export function isThreadChatModelId(id: unknown): id is ChatModelId {
  return (
    typeof id === "string" &&
    THREAD_CHAT_MODELS.some((model) => model.id === id)
  )
}

/** 线性聊天允许使用的模型 id；与 Thread surface 一样从注册表派生。 */
export function isLinearChatModelId(id: unknown): id is ChatModelId {
  if (typeof id !== "string") return false
  return getChatModel(id)?.surfaces.includes("linear") === true
}

/** 校验并回退到默认模型，避免请求体传入未知 id。 */
export function resolveModelId(id: string | undefined): ChatModelId {
  return isChatModelId(id) ? id : DEFAULT_MODEL_ID
}

/** 校验并回退为 Thread Chat 当前可选模型，避免历史树保留已下线选项。 */
export function resolveThreadChatModelId(id: string | undefined): ChatModelId {
  return isThreadChatModelId(id) ? id : DEFAULT_THREAD_CHAT_MODEL_ID
}
