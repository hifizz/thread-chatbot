import type { MessageContentInput } from "@/lib/thread-chat/contracts/message-content"

export type ConversationComposerProps = {
  variant: "column" | "canvas"; threadId: string; isMain: boolean; busy: boolean; prefill?: string | null;
  modelId?: string; modelSelectorDisabled: boolean; modelSelectorDisabledReason?: "branch" | "busy";
  onModelChange?(modelId: string): void | Promise<unknown>; onSend?(content: MessageContentInput): unknown | Promise<unknown>;
  onStop?(): void; onBeforeSend?(): void
}
