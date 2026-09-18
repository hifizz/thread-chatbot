import { ANTHROPIC_ADAPTIVE_GENERATION_SETTINGS, GPT_5_6_GENERATION_SETTINGS, GPT_6_GENERATION_SETTINGS, GPT_5_4_GENERATION_SETTINGS } from "@/constants/generation-settings"
import { MAX_OUTPUT_TOKEN_OPTIONS, type GenerationSettingsCapability } from "@/constants/generation-settings"
import { defineProviderModels } from "@/constants/models/types"

const adaptiveGenerationCapabilities = {
  generationSettings: ANTHROPIC_ADAPTIVE_GENERATION_SETTINGS,
}
const gptCapabilities = { attachments: true, reasoning: true, generationSettings: GPT_5_6_GENERATION_SETTINGS }
const astraCapabilities = { ...gptCapabilities, generationSettings: GPT_6_GENERATION_SETTINGS }
const previousGptCapabilities = { ...gptCapabilities, generationSettings: GPT_5_4_GENERATION_SETTINGS }
// 官方 V4 与 GLM-5.3 均覆盖产品现有的 16K–128K 输出选项。
const alwaysThinkingSettings = {
  effortLevels: ["low", "high", "max"],
  maxOutputTokenOptions: MAX_OUTPUT_TOKEN_OPTIONS,
} as const satisfies GenerationSettingsCapability
const deepseekSettings = {
  ...alwaysThinkingSettings,
  effortLevels: ["none", "low", "high", "max"],
} as const satisfies GenerationSettingsCapability
const deepseekCapabilities = { imageInput: true, reasoning: true, generationSettings: deepseekSettings }
const glmCapabilities = { imageInput: false, reasoning: true, generationSettings: alwaysThinkingSettings }
// 仅开放产品支持且 OpenRouter 明确列出的档位，不为无 effort 参数的模型猜测档位。
const qwenMaxCapabilities = { reasoning: true, generationSettings: {
  effortLevels: ["low", "medium", "high", "xhigh"],
  maxOutputTokenOptions: MAX_OUTPUT_TOKEN_OPTIONS,
} } as const
const museCapabilities = { reasoning: true, generationSettings: {
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
  maxOutputTokenOptions: MAX_OUTPUT_TOKEN_OPTIONS,
} } as const
// 请求兼容规则仅在 Token Router 声明，由服务端统一应用。
const deepseekRequestPolicy = { thinking: "optional", toolChoice: "omit" } as const
const glmRequestPolicy = { thinking: "required", toolChoice: "auto" } as const

/** 当前入口的唯一模型目录。publicId 保留历史会话身份，与实际 provider 解耦。 */
export const tokenRouterModels = defineProviderModels({
  id: "token-router",
  name: "Token Router",
  defaults: {
    surfaces: ["linear", "thread"],
    capabilities: { imageInput: true },
    unbilledPreview: true,
  },
  // contextLabel 为暂定展示值；不得用作真实 token 预算。
  models: [
    // 2026-09-18 核对 https://openrouter.ai/api/v1/models；请求 ID 不带厂商前缀。
    { id: "deepseek-v4.1-flash", publicId: "token-router-deepseek-v4.1-flash", contextLabel: "1M ctx", capabilities: deepseekCapabilities, requestPolicy: deepseekRequestPolicy },
    // OpenRouter 的无日期页面已指向 0902；中转站仍可分别配置别名和固定版本。
    { id: "qwen3.8-max", publicId: "token-router-qwen3.8-max", contextLabel: "1M ctx", capabilities: qwenMaxCapabilities },
    { id: "qwen3.8-max-0902", publicId: "token-router-qwen3.8-max-0902", contextLabel: "1M ctx", capabilities: qwenMaxCapabilities },
    { id: "qwen3.8-flash", publicId: "token-router-qwen3.8-flash", contextLabel: "1M ctx", capabilities: { reasoning: true } },
    { id: "gemini-3.8-flash", publicId: "token-router-gemini-3.8-flash", contextLabel: "1M ctx", capabilities: { reasoning: true, generationSettings: { effortLevels: ["low", "medium", "high"], maxOutputTokenOptions: [16_000, 32_000, 64_000] } } },
    { id: "minimax-m3", publicId: "token-router-minimax-m3", contextLabel: "1M ctx", capabilities: { reasoning: true } },
    { id: "kimi-k2.7-code", publicId: "token-router-kimi-k2.7-code", contextLabel: "262K ctx", capabilities: { reasoning: true } },
    { id: "hy4-preview", publicId: "token-router-hy4-preview", contextLabel: "1M ctx", capabilities: { imageInput: false, reasoning: true, generationSettings: { effortLevels: ["none", "low", "high"], maxOutputTokenOptions: [16_000, 32_000, 64_000] } } },
    { id: "muse-spark-1.3", publicId: "token-router-muse-spark-1.3", contextLabel: "1M ctx", capabilities: museCapabilities },
    { id: "muse-spark-1.3-contributor", publicId: "token-router-muse-spark-1.3-contributor", contextLabel: "1M ctx", capabilities: museCapabilities },
    { id: "kimi-k3", publicId: "token-router-kimi-k3", contextLabel: "1M ctx", capabilities: { reasoning: true, generationSettings: deepseekSettings } },
    { id: "grok-4.6", publicId: "token-router-grok-4.6", contextLabel: "500K ctx", capabilities: qwenMaxCapabilities },
    // https://openrouter.ai/stealth/union-alpha：已揭晓为 Pareto；保留用户中转站别名。
    { id: "union-alpha", publicId: "token-router-union-alpha", contextLabel: "262K ctx" },
    { id: "mimo-v2.5-pro", publicId: "token-router-mimo-v2.5-pro", contextLabel: "1M ctx", capabilities: { imageInput: false, reasoning: true } },
    // https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3：始终思考，仅 low/high/max。
    { id: "glm-5.3", publicId: "token-router-glm-5.3", name: "GLM-5.3", contextLabel: "1M ctx", capabilities: glmCapabilities, requestPolicy: glmRequestPolicy },
    { id: "glm-5.3-flash", publicId: "token-router-glm-5.3-flash", name: "GLM-5.3-Flash", contextLabel: "1M ctx", capabilities: { ...glmCapabilities, imageInput: true }, requestPolicy: glmRequestPolicy },
    { id: "claude-opus-4-6", publicId: "iceland-claude-opus-4-6", name: "Claude Opus 4.6", contextLabel: "1M ctx", capabilities: adaptiveGenerationCapabilities },
    { id: "claude-sonnet-4-6", publicId: "iceland-claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextLabel: "1M ctx" },
    { id: "claude-opus-4-7", publicId: "iceland-claude-opus-4-7", name: "Claude Opus 4.7", contextLabel: "1M ctx", capabilities: adaptiveGenerationCapabilities },
    { id: "claude-fable-5", publicId: "iceland-claude-fable-5", name: "Claude Fable 5", contextLabel: "1M ctx", capabilities: adaptiveGenerationCapabilities },
    { id: "claude-fable-5-1", publicId: "iceland-claude-fable-5-1", name: "Claude Fable 5.1", contextLabel: "1M ctx", capabilities: adaptiveGenerationCapabilities },
    { id: "claude-opus-5", publicId: "iceland-claude-opus-5", name: "Claude Opus 5", contextLabel: "400k ctx", capabilities: adaptiveGenerationCapabilities },
    { id: "claude-sonnet-5", publicId: "iceland-claude-sonnet-5", name: "Claude Sonnet 5", contextLabel: "1M ctx" },
    { id: "claude-opus-4-8", publicId: "iceland-claude-opus-4-8", name: "Claude Opus 4.8", contextLabel: "1M ctx", capabilities: adaptiveGenerationCapabilities },
    { id: "claude-haiku-4-5", publicId: "iceland-claude-haiku-4-5", name: "Claude Haiku 4.5", contextLabel: "200k ctx" },
    {
      id: "gpt-5.6-sol", publicId: "private-relay-gpt-5.6-sol", name: "GPT-5.6 Sol", contextLabel: "400k ctx", capabilities: gptCapabilities,
      description: "质量优先，适合复杂推理、复杂编码和专业工作。",
    },
    {
      id: "gpt-6-astra", publicId: "private-relay-gpt-6-astra", name: "GPT-6 Astra", contextLabel: "1M ctx", capabilities: astraCapabilities,
      description: "质量优先，适合复杂推理、复杂编码和专业工作。",
    },
    {
      id: "gpt-5.6-terra", publicId: "private-relay-gpt-5.6-terra", name: "GPT-5.6 Terra", contextLabel: "400k ctx", capabilities: gptCapabilities,
      description: "能力、延迟和配额消耗均衡，推荐用于日常复杂任务。",
    },
    {
      id: "gpt-5.6-luna", publicId: "private-relay-gpt-5.6-luna", name: "GPT-5.6 Luna", contextLabel: "400k ctx", capabilities: gptCapabilities,
      description: "面向高吞吐和低消耗任务的快速模型，适合日常任务。",
    },
    {
      id: "gpt-5.5", publicId: "private-relay-gpt-5.5", name: "GPT-5.5", contextLabel: "400k ctx", capabilities: previousGptCapabilities,
      description: "高能力通用模型，适合作为复杂工具型 Agent 的回退。",
    },
    {
      id: "gpt-5.4", publicId: "private-relay-gpt-5.4", name: "GPT-5.4", contextLabel: "1M ctx", capabilities: previousGptCapabilities,
      description: "成熟的通用编码与专业工作模型，适合作为稳定回退。",
    },
    {
      id: "gpt-5.4-mini", publicId: "private-relay-gpt-5.4-mini", name: "GPT-5.4 Mini", contextLabel: "400k ctx", capabilities: previousGptCapabilities,
      description: "面向高吞吐的快速模型，适合编码和子 Agent。",
    },
    {
      id: "gpt-5.3-codex-spark", publicId: "private-relay-gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", contextLabel: "128k ctx", capabilities: { attachments: true },
      description: "快速 Codex 编码模型；兼容性验证中。",
    },
  ],
  toPublicModelId: (modelId) => `token-router-${modelId}`,
})
