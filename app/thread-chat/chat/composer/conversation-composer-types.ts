import type { MessageContentInput } from "@/lib/thread-chat/contracts/message-content"
import type { ThreadRepositoryBinding } from "@/lib/thread-chat/contracts/dto"

export type ConversationComposerProps = {
  variant: "column" | "canvas"; threadId: string; isMain: boolean; busy: boolean; prefill?: string | null;
  modelId?: string; modelSelectorDisabled: boolean; modelSelectorDisabledReason?: "branch" | "busy";
  onModelChange?(modelId: string): void | Promise<unknown>; onSend?(content: MessageContentInput): unknown | Promise<unknown>;
  onStop?(): void; onBeforeSend?(): void
  repoBinding?: ThreadRepositoryBinding | null
  onRepoBindingChange?(binding: ThreadRepositoryBinding | null): void | Promise<unknown>
}
