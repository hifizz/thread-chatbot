"use client"

import type { LucideIcon } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MESSAGE_ACTION_LABELS } from "./message-action-types"

export interface MessageToolbarAction {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  pressed?: boolean
  disabled?: boolean
  disabledReason?: string
  busy?: boolean
}

export function MessageToolbar({
  align,
  actions,
}: {
  align: "start" | "end"
  actions: readonly MessageToolbarAction[]
}) {
  return (
    <TooltipProvider delay={300}>
      <div
        className={`message-toolbar ${align}`}
        role="toolbar"
        aria-label={MESSAGE_ACTION_LABELS.toolbar}
      >
        {actions.map((action) => {
          const Icon = action.icon
          const button = (
            <button
              type="button"
              className="message-action"
              aria-label={action.label}
              aria-pressed={action.pressed}
              aria-busy={action.busy || undefined}
              disabled={action.disabled || action.busy}
              onClick={action.onSelect}
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          )
          return (
            <Tooltip key={action.key}>
              <TooltipTrigger
                render={
                  action.disabled ? (
                    <span className="message-action-trigger" tabIndex={0} />
                  ) : (
                    button
                  )
                }
              >
                {action.disabled ? button : undefined}
              </TooltipTrigger>
              <TooltipContent side="top">
                {action.disabledReason ?? action.label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
