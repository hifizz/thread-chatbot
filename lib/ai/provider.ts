import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  gateway,
  type LanguageModel,
} from "ai"
import { minimaxChatModel, isMinimaxConfigured } from "@/lib/ai/minimax"
import { isVercelGatewayConfigured } from "@/lib/payments/vercel-gateway"
import { getChatModel, type ChatModel } from "@/constants/model"

// 统一的对话模型解析层，非 MiniMax 模型按优先级路由：
//   1) Vercel AI 网关（配 AI_GATEWAY_API_KEY）—— 会回传 generationId，供真实成本对账；
//   2) Cloudflare AI 网关 compat 端点（配 CF_AI_GATEWAY_*）；
//   3) 供应商直连。
// MiniMax 两家网关都不支持，始终直连。

const CF_ACCOUNT = process.env.CF_AI_GATEWAY_ACCOUNT_ID
const CF_GATEWAY = process.env.CF_AI_GATEWAY_ID
const CF_TOKEN = process.env.CF_AI_GATEWAY_TOKEN

/** CF AI 网关 compat 端点是否已配置。 */
export function isGatewayConfigured(): boolean {
  return Boolean(CF_ACCOUNT && CF_GATEWAY)
}

function gatewayCompatBaseURL(): string {
  return `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT}/${CF_GATEWAY}/compat`
}

// 各供应商的 API key 与直连 baseURL（网关未配置时的回退）。
const PROVIDER_ENV: Record<
  Exclude<ChatModel["provider"], "minimax">,
  { key: string | undefined; directBaseURL: string }
> = {
  deepseek: {
    key: process.env.DEEPSEEK_API_KEY,
    // 可用 *_BASE_URL 覆盖直连地址（自建/区域代理），未设置则用官方端点。
    directBaseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  },
  openai: {
    key: process.env.OPENAI_API_KEY,
    directBaseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  },
}

/** 该模型是否具备可用配置（有对应 key / 网关）。用于给出友好报错。 */
export function isModelConfigured(model: ChatModel): boolean {
  if (model.provider === "minimax") return isMinimaxConfigured()
  // Vercel 网关配了就能用（它自带各家凭据）；否则需要该供应商的直连/CF key。
  if (isVercelGatewayConfigured()) return true
  return Boolean(PROVIDER_ENV[model.provider].key)
}

/**
 * 把注册表模型解析为 AI SDK 的 LanguageModel。
 * 抛错场景：未知模型 id 或所选模型缺少配置——交由 chat route 转成可读提示。
 */
export function resolveChatModel(modelId: string): LanguageModel {
  const model = getChatModel(modelId)
  if (!model) throw new Error(`未知模型：${modelId}`)

  if (model.provider === "minimax") {
    return minimaxChatModel(model.upstreamModel)
  }

  // 优先 Vercel AI 网关：用 "creator/model" 标识（复用 gatewayModel），响应带 generationId。
  // Vercel 网关自带鉴权/计费，无需各供应商的 key。
  if (isVercelGatewayConfigured()) {
    const base = gateway(
      model.gatewayModel ?? `${model.provider}/${model.upstreamModel}`
    )
    return model.reasoning
      ? wrapLanguageModel({
          model: base,
          middleware: extractReasoningMiddleware({ tagName: "think" }),
        })
      : base
  }

  const env = PROVIDER_ENV[model.provider]
  if (!env.key) throw new Error(`模型 ${model.name} 未配置 API Key`)

  const useGateway = isGatewayConfigured()
  const provider = createOpenAICompatible({
    name: `${model.provider}${useGateway ? "-via-cf" : ""}`,
    baseURL: useGateway ? gatewayCompatBaseURL() : env.directBaseURL,
    apiKey: env.key,
    // 经网关时可选携带网关鉴权头（网关侧开启 Authenticated Gateway 时必需）。
    headers:
      useGateway && CF_TOKEN
        ? { "cf-aig-authorization": `Bearer ${CF_TOKEN}` }
        : undefined,
  })

  // 网关 compat 端点用 "provider/model" 标识；直连用供应商原生模型名。
  const upstreamId = useGateway
    ? (model.gatewayModel ?? model.upstreamModel)
    : model.upstreamModel
  const base = provider(upstreamId)

  // DeepSeek reasoner 等会输出 <think>，通用 chat 模型不需要抽取；此处按需包裹。
  return model.reasoning
    ? wrapLanguageModel({
        model: base,
        middleware: extractReasoningMiddleware({ tagName: "think" }),
      })
    : base
}
