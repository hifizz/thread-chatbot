/** Thread Chat 可由用户调整的最终回答生成参数。 */
export const EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export const MAX_OUTPUT_TOKEN_OPTIONS = [
  16_000,
  32_000,
  64_000,
  128_000,
] as const

export type MaxOutputTokens = (typeof MAX_OUTPUT_TOKEN_OPTIONS)[number]

export interface GenerationSettings {
  effort: EffortLevel
  maxOutputTokens: MaxOutputTokens
}

export interface GenerationSettingsCapability {
  effortLevels: readonly EffortLevel[]
  maxOutputTokenOptions: readonly MaxOutputTokens[]
}

export const DEFAULT_GENERATION_SETTINGS = {
  effort: "high",
  maxOutputTokens: 32_000,
} as const satisfies GenerationSettings

export const ANTHROPIC_ADAPTIVE_GENERATION_SETTINGS = {
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
  maxOutputTokenOptions: MAX_OUTPUT_TOKEN_OPTIONS,
} as const satisfies GenerationSettingsCapability

/** 2026-09-08 官方模型页：5.6 三款支持 none 至 max，Astra 不支持 none。 */
export const GPT_5_6_GENERATION_SETTINGS = {
  effortLevels: EFFORT_LEVELS,
  maxOutputTokenOptions: MAX_OUTPUT_TOKEN_OPTIONS,
} as const satisfies GenerationSettingsCapability

export const GPT_6_GENERATION_SETTINGS = {
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
  maxOutputTokenOptions: MAX_OUTPUT_TOKEN_OPTIONS,
} as const satisfies GenerationSettingsCapability

/** 5.4、5.4 Mini 与 5.5 的最高档位为 xhigh，不开放 max。 */
export const GPT_5_4_GENERATION_SETTINGS = {
  effortLevels: ["none", "low", "medium", "high", "xhigh"],
  maxOutputTokenOptions: MAX_OUTPUT_TOKEN_OPTIONS,
} as const satisfies GenerationSettingsCapability

export const MAX_OUTPUT_TOKEN_LABELS: Record<MaxOutputTokens, string> = {
  16_000: "16K",
  32_000: "32K",
  64_000: "64K",
  128_000: "128K",
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return EFFORT_LEVELS.includes(value as EffortLevel)
}

export function isMaxOutputTokens(value: unknown): value is MaxOutputTokens {
  return MAX_OUTPUT_TOKEN_OPTIONS.includes(value as MaxOutputTokens)
}
