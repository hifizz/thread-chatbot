"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import type { TurnVariantPickerProps } from "./message-action-types"

export function TurnVariantPicker({
  threadId,
  activeAssistantMessageId,
  alternatives,
  onSwitch,
}: TurnVariantPickerProps) {
  if (alternatives.length < 2) return null
  const activeIndex = Math.max(
    0,
    alternatives.findIndex(
      (alternative) =>
        alternative.assistantMessageId === activeAssistantMessageId
    )
  )
  const switchTo = (index: number) => {
    const target = alternatives[index]
    if (target) void onSwitch(threadId, target.assistantMessageId)
  }
  const active = alternatives[activeIndex]

  return (
    <div className="turn-variant-picker" aria-label="回复版本切换">
      <button
        type="button"
        aria-label="上一个回复版本"
        disabled={activeIndex === 0}
        onClick={() => switchTo(activeIndex - 1)}
      >
        <ChevronLeft size={14} />
      </button>
      <span>
        {activeIndex + 1}/{alternatives.length}
      </span>
      <button
        type="button"
        aria-label="下一个回复版本"
        disabled={activeIndex === alternatives.length - 1}
        onClick={() => switchTo(activeIndex + 1)}
      >
        <ChevronRight size={14} />
      </button>
      {active?.derivedThreadCount ? (
        <span className="variant-derived">
          {active.derivedThreadCount} 个派生分支
        </span>
      ) : null}
    </div>
  )
}
