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

export function GenerationSettingsControls({
  modelId,
  disabled,
}: {
  modelId: string
  disabled: boolean
}) {
  const capability = getModelGenerationSettingsCapability(modelId)
  const { settings, setSettings } = useGenerationSettings()
  if (!capability) return null

  return (
    <>
      <Select
        value={settings.effort}
        onValueChange={(effort) => {
          if (
            !isEffortLevel(effort) ||
            !capability.effortLevels.includes(effort)
          )
            return
          setSettings((current) => ({ ...current, effort }))
        }}
      >
        <SelectTrigger
          size="sm"
          disabled={disabled}
          aria-label="选择推理强度"
        >
          <SelectValue>Effort: {settings.effort}</SelectValue>
        </SelectTrigger>
        <SelectContent side="top" align="start">
          {capability.effortLevels.map((effort) => (
            <SelectItem key={effort} value={effort}>
              {effort}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(settings.maxOutputTokens)}
        onValueChange={(value) => {
          const maxOutputTokens = Number(value)
          if (
            !isMaxOutputTokens(maxOutputTokens) ||
            !capability.maxOutputTokenOptions.includes(maxOutputTokens)
          )
            return
          setSettings((current) => ({ ...current, maxOutputTokens }))
        }}
      >
        <SelectTrigger
          size="sm"
          disabled={disabled}
          aria-label="选择最大输出 token"
        >
          <SelectValue>
            Max: {MAX_OUTPUT_TOKEN_LABELS[settings.maxOutputTokens]}
          </SelectValue>
        </SelectTrigger>
        <SelectContent side="top" align="start">
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
