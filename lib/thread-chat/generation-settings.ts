import { DEFAULT_GENERATION_SETTINGS, type GenerationSettings, type GenerationSettingsCapability } from "@/constants/generation-settings"
import { getModelGenerationSettingsCapability } from "@/constants/model"

/** 浏览器与服务端共享：未选择时采用模型默认，切换模型后回退不兼容的偏好。 */
export function resolveGenerationSettings(
  modelId: string | undefined,
  settings: GenerationSettings | undefined,
  capability: GenerationSettingsCapability | undefined = getModelGenerationSettingsCapability(modelId)
): GenerationSettings | undefined {
  if (!capability) return undefined
  const { effortLevels, maxOutputTokenOptions } = capability
  const defaults = capability.defaults ?? DEFAULT_GENERATION_SETTINGS
  const fallbackEffort = defaults.effort && effortLevels.includes(defaults.effort) ? defaults.effort : effortLevels[0]
  const fallbackTokens = maxOutputTokenOptions.includes(defaults.maxOutputTokens) ? defaults.maxOutputTokens : maxOutputTokenOptions[0]
  if (fallbackTokens === undefined) return undefined
  return {
    ...(fallbackEffort !== undefined ? { effort: settings?.effort && effortLevels.includes(settings.effort) ? settings.effort : fallbackEffort } : {}),
    maxOutputTokens: settings && maxOutputTokenOptions.includes(settings.maxOutputTokens) ? settings.maxOutputTokens : fallbackTokens,
  }
}
