import {
  DEFAULT_GENERATION_SETTINGS,
  type GenerationSettings,
} from "@/constants/generation-settings"
import { getModelGenerationSettingsCapability } from "@/constants/model"

/** 显示与发送共用同一组有效值；切换模型时不把上一模型的无效档位发给服务端。 */
export function resolveGenerationSettings(
  modelId: string | undefined,
  settings: GenerationSettings
): GenerationSettings | undefined {
  const capability = getModelGenerationSettingsCapability(modelId)
  if (!capability) return undefined
  const { effortLevels, maxOutputTokenOptions } = capability
  const fallbackEffort = effortLevels.includes(DEFAULT_GENERATION_SETTINGS.effort)
    ? DEFAULT_GENERATION_SETTINGS.effort : effortLevels[0]
  const fallbackTokens = maxOutputTokenOptions.includes(DEFAULT_GENERATION_SETTINGS.maxOutputTokens)
    ? DEFAULT_GENERATION_SETTINGS.maxOutputTokens : maxOutputTokenOptions[0]
  if (fallbackEffort === undefined || fallbackTokens === undefined) return undefined
  return {
    effort: effortLevels.includes(settings.effort) ? settings.effort : fallbackEffort,
    maxOutputTokens: maxOutputTokenOptions.includes(settings.maxOutputTokens) ? settings.maxOutputTokens : fallbackTokens,
  }
}
