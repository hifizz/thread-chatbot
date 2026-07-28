// 对话模型注册表（单一事实来源）。
// id 在全站统一使用：输入框选择器、计费定价（constants/pricing.ts 的 key）、
// 服务端 provider 解析（lib/ai/provider.ts）。

export type ChatModelProvider = "minimax" | "deepseek" | "openai" | "ark"

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
  /** 该模型输出是否用 <think> 包裹推理（需 reasoning 抽取中间件） */
  reasoning?: boolean
}

export const CHAT_MODELS: readonly ChatModel[] = [
  {
    id: "minimax-m2",
    name: "MiniMax M2",
    description: "通用对话模型（直连）",
    provider: "minimax",
    upstreamModel: "MiniMax-M2",
    reasoning: true,
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek V3.2",
    description: "高性价比通用模型（经 CF AI 网关）",
    provider: "deepseek",
    upstreamModel: "deepseek-chat",
    gatewayModel: "deepseek/deepseek-chat",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    description: "OpenAI 轻量模型（经 CF AI 网关）",
    provider: "openai",
    upstreamModel: "gpt-4o-mini",
    gatewayModel: "openai/gpt-4o-mini",
  },
  {
    id: "doubao-seed-2.1-turbo",
    name: "Doubao Seed 2.1 Turbo",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "doubao-seed-2.1-turbo",
  },
  {
    id: "doubao-seed-2.0-lite",
    name: "Doubao Seed 2.0 Lite",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "doubao-seed-2.0-lite",
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "minimax-m2.7",
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "minimax-m3",
  },
  {
    id: "glm-5.2",
    name: "GLM-5.2",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "glm-5.2",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "deepseek-v4-flash",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "deepseek-v4-pro",
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "kimi-k2.6",
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    description: "火山方舟 Coding Plan",
    provider: "ark",
    upstreamModel: "kimi-k2.7-code",
  },
]

export const DEFAULT_MODEL_ID = "minimax-m2"

/**
 * Thread Chat MVP 已接入、并允许用户在 selector 中切换的模型。
 * M2 / M2.7 暂不在该产品入口展示，但仍保留在全站注册表，确保既有通用聊天配置可用。
 */
export const THREAD_CHAT_MODELS: readonly ChatModel[] = CHAT_MODELS.filter(
  (model) =>
    (model.provider === "minimax" || model.provider === "ark") &&
    model.id !== "minimax-m2" &&
    model.id !== "minimax-m2.7"
)

/** Thread Chat 新建树及旧树模型回退使用的默认模型。 */
export const DEFAULT_THREAD_CHAT_MODEL_ID = "glm-5.2"

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

export function isChatModelId(id: unknown): id is string {
  return typeof id === "string" && getChatModel(id) !== undefined
}

/** Thread Chat 允许写入 Thread 的模型 id。 */
export function isThreadChatModelId(id: unknown): id is string {
  return (
    typeof id === "string" && THREAD_CHAT_MODELS.some((model) => model.id === id)
  )
}

/** 校验并回退到默认模型，避免请求体传入未知 id。 */
export function resolveModelId(id: string | undefined): string {
  return getChatModel(id) ? (id as string) : DEFAULT_MODEL_ID
}

/** 校验并回退为 Thread Chat 当前可选模型，避免历史树保留已下线选项。 */
export function resolveThreadChatModelId(id: string | undefined): string {
  return isThreadChatModelId(id) ? id : DEFAULT_THREAD_CHAT_MODEL_ID
}
