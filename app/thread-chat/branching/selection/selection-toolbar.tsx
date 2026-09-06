"use client"

import React from "react"
import { Bookmark, Highlighter, MessageSquare, PanelTopOpen } from "lucide-react"
import { SELECTION_TOOLBAR_COPY as COPY } from "@/constants/selection-toolbar"

export function SelectionToolbar({ onContinue, onAsk }: {
  onContinue(): void
  onAsk(): void
}) {
  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label={COPY.label}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        const buttons = Array.from(event.currentTarget.querySelectorAll("button"))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length
        event.preventDefault()
        buttons[next]?.focus()
      }}
    >
      <button type="button" aria-label={COPY.continueLabel} title={COPY.continueLabel} onClick={onContinue}>
        <MessageSquare size={16} aria-hidden="true" />{COPY.continue}
      </button>
      <button type="button" aria-label={COPY.askLabel} title={COPY.askLabel} onClick={onAsk}>
        <PanelTopOpen size={16} aria-hidden="true" />{COPY.ask}
      </button>
      {[{ label: COPY.bookmark, Icon: Bookmark }, { label: COPY.marker, Icon: Highlighter }].map(({ label, Icon }) => (
        <span className="selection-coming-soon" key={label}>
          {/* 保留焦点及 hover，aria-disabled + 无动作保证鼠标与键盘均不可触发。 */}
          <button type="button" aria-disabled="true" aria-label={`${label}（${COPY.developing}）`}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>
          <span className="selection-coming-soon-hint" role="tooltip">{COPY.developing}</span>
        </span>
      ))}
    </div>
  )
}
