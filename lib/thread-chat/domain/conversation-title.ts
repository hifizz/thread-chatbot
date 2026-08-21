import type {
  Conversation,
  ConversationThread,
  ThreadId,
} from "./conversation-model.ts"

export const UNTITLED_CONVERSATION_TITLE = "未命名对话"
export const UNTITLED_THREAD_TITLE = "未命名分支"

export function resolveConversationTitle(conversation: Conversation): string {
  return (
    conversation.customTitle?.trim() ||
    conversation.autoTitle?.trim() ||
    UNTITLED_CONVERSATION_TITLE
  )
}

export function resolveThreadTitle(input: {
  readonly conversation: Conversation
  readonly thread: ConversationThread
}): string {
  if (input.thread.id === input.conversation.rootThreadId)
    return resolveConversationTitle(input.conversation)
  return input.thread.localTitle?.trim() || UNTITLED_THREAD_TITLE
}

export function isRootThread(
  conversation: Conversation,
  candidateThreadId: ThreadId
): boolean {
  return conversation.rootThreadId === candidateThreadId
}
