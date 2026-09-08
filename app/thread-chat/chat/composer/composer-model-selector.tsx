"use client"

import { useState } from "react"
import { Menu } from "@base-ui/react/menu"
import { ComposerMenu, ComposerModelItem, ComposerModelTrigger } from "@/components/assistant-ui/elements/composer"
import { OfficialComposerTheme } from "@/components/assistant-ui/official-composer-demo/theme"
import { getChatModel } from "@/constants/model"
import { THREAD_CHAT_MODEL_OPTIONS } from "@/constants/models"
import { COMPOSER_MODEL_COPY } from "@/constants/composer-model"

type ComposerModelSelectorProps = {
  modelId?: string
  disabled: boolean
  disabledReason?: "branch" | "busy"
  onValueChange?: (modelId: string) => void
}

/** 官方菜单负责外观，Base UI 负责定位、键盘导航、关闭与焦点归还。 */
export function ComposerModelSelector({ modelId, disabled, disabledReason, onValueChange }: ComposerModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const locked = disabled || !onValueChange
  const title = disabledReason === "branch" ? COMPOSER_MODEL_COPY.branchLocked
    : disabledReason === "busy" ? COMPOSER_MODEL_COPY.busy
    : locked ? COMPOSER_MODEL_COPY.unavailable : COMPOSER_MODEL_COPY.choose

  return <Menu.Root open={open && !locked} onOpenChange={setOpen} modal={false}>
    <span title={title}>
      <Menu.Trigger disabled={locked} aria-label={COMPOSER_MODEL_COPY.choose}
        render={<ComposerModelTrigger model={getChatModel(modelId)?.name ?? modelId ?? COMPOSER_MODEL_COPY.current} open={open && !locked} />} />
    </span>
    <Menu.Portal>
      <OfficialComposerTheme>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Menu.Popup aria-label={COMPOSER_MODEL_COPY.choose}
            render={<ComposerMenu open={open && !locked} className="relative bottom-auto mb-0 max-h-[min(24rem,var(--available-height))] max-w-[calc(100vw-2rem)] overflow-y-auto outline-none" />}>
            <Menu.RadioGroup value={modelId} onValueChange={onValueChange} className="flex flex-col gap-0.5">
              {THREAD_CHAT_MODEL_OPTIONS.map((model) => <Menu.RadioItem key={model.id} value={model.id} label={model.name} nativeButton closeOnClick
                render={<ComposerModelItem entry={{ name: model.name, meta: model.contextLabel ?? "" }} selected={model.id === modelId}
                  className="outline-none data-highlighted:bg-foreground/[0.04]" />} />)}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </OfficialComposerTheme>
    </Menu.Portal>
  </Menu.Root>
}
