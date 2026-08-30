"use client"

import {
  ModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/model-selector"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  CHAT_MODEL_PROVIDER_LABELS,
<<<<<<< HEAD
  THREAD_CHAT_MODEL_GROUP_LABELS,
=======
>>>>>>> a30b2c9 (feat(chat): group model selector by provider)
  THREAD_CHAT_MODELS,
} from "@/constants/model"
import { Bot } from "lucide-react"

/** 模型 selector 的产品展示顺序；同一品牌内沿用模型注册表顺序。 */
const MODEL_FAMILY_ORDER = [
  "openai",
  "gpt",
  "claude",
  "glm",
  "qwen",
  "kimi",
  "moonshotai",
  "deepseek",
  "x-ai",
  "minimax",
  "doubao",
] as const

/** 服务端供应商只用于排序和路由；用户界面统一展示为中性模型组。 */
function modelProviderIndex(provider: string): number {
  if (provider === "umapis") return 0
  if (provider === "openrouter") return 2
  return 1
}

function modelFamilyIndex(upstreamModel: string): number {
  const normalizedName = upstreamModel.toLowerCase()
  const familyIndex = MODEL_FAMILY_ORDER.findIndex((family) =>
    normalizedName.startsWith(family)
  )

  return familyIndex === -1 ? MODEL_FAMILY_ORDER.length : familyIndex
}

/**
 * Thread Chat 仅展示当前产品入口可用的模型。
 * 隐藏项和未接入 provider 仍保留在全站注册表，避免影响其他入口与历史配置。
 */
const THREAD_CHAT_MODEL_OPTIONS: readonly ModelOption[] =
  THREAD_CHAT_MODELS.map((model, registryIndex) => ({ model, registryIndex }))
    .sort(
      (left, right) =>
        modelProviderIndex(left.model.provider) -
          modelProviderIndex(right.model.provider) ||
        modelFamilyIndex(left.model.upstreamModel) -
          modelFamilyIndex(right.model.upstreamModel) ||
        left.registryIndex - right.registryIndex
    )
    .map(({ model }) => ({
      id: model.id,
<<<<<<< HEAD
      name: model.name.replace(
        `${CHAT_MODEL_PROVIDER_LABELS[model.provider]} · `,
        ""
      ),
      providerId: model.provider,
      providerName: THREAD_CHAT_MODEL_GROUP_LABELS[model.provider],
=======
      name: model.name,
      description: model.description,
      providerId: model.provider,
      providerName: CHAT_MODEL_PROVIDER_LABELS[model.provider],
>>>>>>> a30b2c9 (feat(chat): group model selector by provider)
    }))

export interface ThreadModelSelectorProps {
  modelId: string
  disabled: boolean
  /** 画布就地输入框只保留模型入口，避免模型名挤占输入空间。 */
  compact?: boolean
  /** 禁用来源决定是否需要向用户解释模型策略。 */
  disabledReason?: "branch" | "busy"
  onValueChange: (modelId: string) => void
}

const BRANCH_MODEL_LOCK_MESSAGE =
  "暂时不支持在非主线分支切换模型，我们后续会支持"

/**
 * Thread Chat 不使用 assistant-ui runtime，因此走 ModelSelector 的 compound API，
 * 只复用可访问的选择器 UI，模型状态仍由 Thread store 单独持有。
 */
export function ThreadModelSelector({
  modelId,
  disabled,
  compact = false,
  disabledReason,
  onValueChange,
}: ThreadModelSelectorProps) {
  const isBranchLocked = disabledReason === "branch"
  const trigger = (
    <ModelSelector.Trigger
      aria-label="选择对话模型"
      title={disabled ? "当前会话暂不可切换模型" : "选择对话模型"}
      variant="ghost"
      size="sm"
      disabled={disabled}
      className={`thread-model-selector${compact ? "compact" : ""}${isBranchLocked ? "branch-locked" : ""}`}
    >
      {compact ? <Bot aria-hidden="true" size={12} /> : undefined}
    </ModelSelector.Trigger>
  )

  return (
    <ModelSelector.Root
      models={THREAD_CHAT_MODEL_OPTIONS}
      value={modelId}
      onValueChange={onValueChange}
    >
      {isBranchLocked ? (
        <TooltipProvider delay={300}>
          <Tooltip>
            {/* disabled button 不接收 hover/focus；由可聚焦外层触发 Tooltip。 */}
            <TooltipTrigger
              render={
                <span
                  className="thread-model-selector-tooltip-trigger"
                  tabIndex={0}
                />
              }
            >
              {trigger}
            </TooltipTrigger>
            <TooltipContent side="top">
              {BRANCH_MODEL_LOCK_MESSAGE}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        trigger
      )}
      <ModelSelector.Content
        side="top"
<<<<<<< HEAD
        className="thread-model-selector-content w-[28rem] max-w-[calc(100vw-1rem)]"
=======
        className="thread-model-selector-content w-[34rem] max-w-[calc(100vw-2rem)]"
>>>>>>> a30b2c9 (feat(chat): group model selector by provider)
      />
    </ModelSelector.Root>
  )
}
