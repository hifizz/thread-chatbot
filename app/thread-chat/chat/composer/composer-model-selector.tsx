"use client"

import { ModelLogo } from "@/components/assistant-ui/model-logo"
import { useState } from "react"
import { Menu } from "@base-ui/react/menu"
import { ComposerMenu } from "@/components/assistant-ui/elements/composer/menu"
import { ComposerModelItem, ComposerModelTrigger } from "@/components/assistant-ui/elements/composer/models"
import { ComposerTheme } from "@/components/assistant-ui/elements/composer/theme"
import { getChatModel } from "@/constants/model"
import { THREAD_CHAT_MODEL_OPTIONS } from "@/constants/models"
import { COMPOSER_MODEL_COPY } from "@/constants/composer-model"
import { DisabledComposerOption } from "./disabled-composer-option"

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
    <DisabledComposerOption disabled={locked} reason={title}>
      <Menu.Trigger disabled={locked} aria-label={COMPOSER_MODEL_COPY.choose}
        render={<ComposerModelTrigger className="disabled:opacity-50" model={getChatModel(modelId)?.name ?? modelId ?? COMPOSER_MODEL_COPY.current} open={open && !locked} />} />
    </DisabledComposerOption>
    <Menu.Portal>
      <ComposerTheme>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Menu.Popup aria-label={COMPOSER_MODEL_COPY.choose}
            render={<ComposerMenu open={open && !locked} className="relative bottom-auto w-[28rem] mb-0 max-h-[min(24rem,var(--available-height))] max-w-[calc(100vw-2rem)] overflow-y-auto outline-none" />}>
            <Menu.RadioGroup value={modelId} onValueChange={onValueChange} className="flex flex-col gap-0.5">
              {THREAD_CHAT_MODEL_OPTIONS.map((model) => <Menu.RadioItem key={model.id} value={model.id} label={model.name} nativeButton closeOnClick
                render={<ComposerModelItem entry={{ name: model.name, meta: model.contextLabel ?? "", icon: <ModelLogo modelId={model.id} /> }} selected={model.id === modelId}
                  className="outline-none data-highlighted:bg-foreground/[0.04]" />} />)}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </ComposerTheme>
    </Menu.Portal>
  </Menu.Root>
}
