import { z } from "zod"
import { EFFORT_LEVELS } from "@/constants/generation-settings"
import { MODEL_LOGOS, MODEL_REQUEST_PROFILES, MODEL_TOKEN_LIMIT } from "@/constants/model-catalog"

const tokenCount = z.number().int().min(1).max(MODEL_TOKEN_LIMIT)
export const modelCatalogConfigSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  upstreamId: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]*$/, "模型 ID 含非法字符"),
  logo: z.enum(MODEL_LOGOS),
  profile: z.enum(MODEL_REQUEST_PROFILES),
  contextWindow: tokenCount.nullable(),
  imageInput: z.boolean(),
  toolCalling: z.boolean(),
  reasoning: z.boolean(),
  effortLevels: z.array(z.enum(EFFORT_LEVELS)).max(EFFORT_LEVELS.length),
  defaultEffort: z.enum(EFFORT_LEVELS).nullable(),
  maxOutputTokens: tokenCount,
  outputTokenOptions: z.array(tokenCount).min(1).max(16),
  defaultMaxOutputTokens: tokenCount,
}).strict().superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message })
  if (new Set(value.effortLevels).size !== value.effortLevels.length) issue("effortLevels", "档位不能重复")
  if (new Set(value.outputTokenOptions).size !== value.outputTokenOptions.length) issue("outputTokenOptions", "输出档位不能重复")
  if (value.effortLevels.length ? value.defaultEffort === null || !value.effortLevels.includes(value.defaultEffort) : value.defaultEffort !== null) issue("defaultEffort", "默认思考强度必须属于支持档位；不支持时请选择无")
  if (!value.reasoning && value.effortLevels.length) issue("reasoning", "开启推理能力后才能配置 effort")
  if (!value.outputTokenOptions.includes(value.defaultMaxOutputTokens)) issue("defaultMaxOutputTokens", "默认输出长度必须属于可选档位")
  if (value.outputTokenOptions.some((n) => n > value.maxOutputTokens)) issue("outputTokenOptions", "输出档位不能超过模型上限")
  if (value.contextWindow !== null && value.maxOutputTokens > value.contextWindow) issue("maxOutputTokens", "输出上限不能超过上下文窗口")
  const constrained = ["deepseek", "glm", "thinking-required"].includes(value.profile)
  const allowed = value.profile === "deepseek" ? ["none", "low", "high", "max"] : ["low", "high", "max"]
  if (constrained && value.effortLevels.some((e) => !allowed.includes(e))) issue("effortLevels", "该兼容策略不支持所选档位")
  if (constrained && (!value.reasoning || !value.defaultEffort)) issue("defaultEffort", "该策略需要配置推理默认档位")
  if (value.profile === "anthropic" && value.effortLevels.length) issue("effortLevels", "普通 Messages 不发送 effort，请选择自适应思考策略")
  if (value.profile === "anthropic-adaptive" && (!value.defaultEffort || value.effortLevels.includes("none"))) issue("defaultEffort", "自适应思考需要非 none 默认档位")
})

export const modelCatalogWriteSchema = z.object({
  id: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]*$/),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(100_000),
  version: z.number().int().min(0),
  config: modelCatalogConfigSchema,
}).strict()
export type ModelCatalogConfig = z.infer<typeof modelCatalogConfigSchema>
export type ModelCatalogWrite = z.infer<typeof modelCatalogWriteSchema>
export type CatalogModel = Omit<ModelCatalogWrite, "version"> & { version: number }
