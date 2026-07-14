// 对话模型注册表（单一事实来源）。
// id 在全站统一使用：输入框选择器、计费定价（constants/pricing.ts 的 key）、
// 服务端 provider 解析（lib/ai/provider.ts）。

export type ChatModelProvider = "minimax" | "deepseek" | "openai"

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
]

export const DEFAULT_MODEL_ID = "minimax-m2"

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

/** 校验并回退到默认模型，避免请求体传入未知 id。 */
export function resolveModelId(id: string | undefined): string {
  return getChatModel(id) ? (id as string) : DEFAULT_MODEL_ID
}
