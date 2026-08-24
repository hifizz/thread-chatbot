"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

export interface MessageVariantOption {
  id: string
  derivedThreadCount?: number
}

export function TurnVariantPicker({
  activeMessageId,
  alternatives,
  onSwitch,
  label = "回复版本切换",
}: {
  activeMessageId: string
  alternatives: readonly MessageVariantOption[]
  onSwitch: (messageId: string) => void
  label?: string
}) {
  if (alternatives.length < 2) return null
  const activeIndex = Math.max(
    0,
    alternatives.findIndex((alternative) => alternative.id === activeMessageId)
  )
  const switchTo = (index: number) => {
    const target = alternatives[index]
    if (target) onSwitch(target.id)
  }
  const active = alternatives[activeIndex]

  return (
    <div className="turn-variant-picker" role="group" aria-label={label}>
      <button
        type="button"
        aria-label="上一个版本"
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
        aria-label="下一个版本"
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
