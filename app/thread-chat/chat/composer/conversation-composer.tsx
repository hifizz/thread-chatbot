"use client"

import type { MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import { OfficialComposerDemo } from "@/components/assistant-ui/official-composer-demo/demo"
import { OfficialComposerTheme } from "@/components/assistant-ui/official-composer-demo/theme"

type ConversationComposerProps = {
  variant: "column" | "canvas"; threadId: string; isMain: boolean; busy: boolean; prefill?: string | null;
  modelId?: string; modelSelectorDisabled: boolean; modelSelectorDisabledReason?: "branch" | "busy";
  onModelChange?(modelId: string): void; onSend?(content: MessageContentInput): unknown | Promise<unknown>;
  onStop?(): void; onBeforeSend?(): void
}

/** 直接挂载官方 Composer，局部主题保留官方样式。业务适配待人工验收后进行。 */
export function ConversationComposer({ threadId }: ConversationComposerProps) {
  return (
    <OfficialComposerTheme key={threadId} embedded>
      <OfficialComposerDemo />
    </OfficialComposerTheme>
  )
}
