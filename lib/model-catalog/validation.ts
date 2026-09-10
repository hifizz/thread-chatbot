import type { GenerationSettings, GenerationSettingsCapability } from "@/constants/generation-settings"
import { IMAGE_ATTACHMENT_LIMITS, IMAGE_MODEL_VALIDATION_MESSAGE } from "@/constants/attachment"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"

export function assertGenerationSettingsCapability(capability: GenerationSettingsCapability | undefined, settings: GenerationSettings | undefined) {
  if (!settings) return
  if (!capability || (settings.effort !== undefined && !capability.effortLevels.includes(settings.effort)) || !capability.maxOutputTokenOptions.includes(settings.maxOutputTokens)) {
    throw new ConversationApplicationError("VALIDATION_ERROR", "当前模型不支持所选生成参数，请刷新页面并重新选择")
  }
}
export function assertImageInputCapability(supportsImages: boolean, imageCount: number) {
  if (imageCount > IMAGE_ATTACHMENT_LIMITS.maxFilesPerMessage) throw new ConversationApplicationError("VALIDATION_ERROR", `单次最多添加 ${IMAGE_ATTACHMENT_LIMITS.maxFilesPerMessage} 张图片`)
  if (imageCount > 0 && !supportsImages) throw new ConversationApplicationError("VALIDATION_ERROR", IMAGE_MODEL_VALIDATION_MESSAGE)
}
