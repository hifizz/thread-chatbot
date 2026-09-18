"use client"

import {
  isEffortLevel,
  isMaxOutputTokens,
  MAX_OUTPUT_TOKEN_LABELS,
} from "@/constants/generation-settings"
import { getModelGenerationSettingsCapability } from "@/constants/model"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useGenerationSettings } from "./generation-settings-context"
import { resolveGenerationSettings } from "@/lib/thread-chat/generation-settings"
import styles from "./artifact-composer.module.css"
import { DisabledComposerOption } from "./disabled-composer-option"
import { COMPOSER_MODEL_KEYS } from "@/constants/composer-model"
import { useI18n } from "@/lib/i18n/client"


export function GenerationSettingsControls({
  modelId,
  disabled,
  disabledReason,
}: {
  modelId: string
  disabled: boolean
  disabledReason?: string
}) {
  const { t } = useI18n()

  const capability = getModelGenerationSettingsCapability(modelId)
  const { settings: preferredSettings, setSettings } = useGenerationSettings()
  const settings = resolveGenerationSettings(modelId, preferredSettings)
  if (!capability || !settings) return null

  return (
    <>
      <Select
        disabled={disabled}
        value={settings.effort}
        onValueChange={(effort) => {
          if (
            !isEffortLevel(effort) ||
            !capability.effortLevels.includes(effort)
          )
            return
          setSettings({ ...settings, effort })
        }}
      >
        <DisabledComposerOption disabled={disabled} reason={disabledReason ?? t(COMPOSER_MODEL_KEYS.unavailable)}>
        <SelectTrigger
          size="sm"
          disabled={disabled}
          aria-label={t("ui.chooseReasoningEffort")}
        >
          <SelectValue><span className={styles.parameterLabel}>Effort:</span> {settings.effort}</SelectValue>
        </SelectTrigger>
        </DisabledComposerOption>
        <SelectContent className={styles.parameterMenu} side="top" sideOffset={8} align="start" alignItemWithTrigger={false}>
          {capability.effortLevels.map((effort) => (
            <SelectItem key={effort} value={effort}>
              {effort}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        disabled={disabled}
        value={String(settings.maxOutputTokens)}
        onValueChange={(value) => {
          const maxOutputTokens = Number(value)
          if (
            !isMaxOutputTokens(maxOutputTokens) ||
            !capability.maxOutputTokenOptions.includes(maxOutputTokens)
          )
            return
          setSettings({ ...settings, maxOutputTokens })
        }}
      >
        <DisabledComposerOption disabled={disabled} reason={disabledReason ?? t(COMPOSER_MODEL_KEYS.unavailable)}>
        <SelectTrigger
          size="sm"
          disabled={disabled}
          aria-label={t("ui.chooseTheMaximumOutputTokens")}
        >
          <SelectValue>
            <span className={styles.parameterLabel}>Max:</span> {MAX_OUTPUT_TOKEN_LABELS[settings.maxOutputTokens]}
          </SelectValue>
        </SelectTrigger>
        </DisabledComposerOption>
        <SelectContent className={styles.parameterMenu} side="top" sideOffset={8} align="start" alignItemWithTrigger={false}>
          {capability.maxOutputTokenOptions.map((maxOutputTokens) => (
            <SelectItem
              key={maxOutputTokens}
              value={String(maxOutputTokens)}
            >
              {MAX_OUTPUT_TOKEN_LABELS[maxOutputTokens]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
