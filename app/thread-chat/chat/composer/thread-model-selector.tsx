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
import { THREAD_CHAT_MODEL_OPTIONS as PUBLIC_MODEL_OPTIONS } from "@/constants/models"
import { Bot } from "lucide-react"

/** Thread Chat 仅展示公开模型选项，不读取服务端路由表。 */
const THREAD_CHAT_MODEL_OPTIONS: readonly ModelOption[] = PUBLIC_MODEL_OPTIONS

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
        className="thread-model-selector-content w-[28rem] max-w-[calc(100vw-1rem)]"
      />
    </ModelSelector.Root>
  )
}
