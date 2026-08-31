import type { ModelMessage } from "ai"
import { compilePromptBase } from "@/lib/thread-chat/application/prompt-compiler"

/**
 * Compatibility wrapper for callers not yet migrated to the two-phase compiler.
 * New generation code should retain the PromptBase so it can calculate stable
 * prefix boundaries before appending runtime control and the current user.
 */
export async function compileModelContext(input: {
  userId: string
  threadId: string
  excludeAssistantMessageId?: string
}): Promise<ModelMessage[]> {
  const base = await compilePromptBase(input)
  return [
    ...base.inheritedMessages,
    ...base.branchHistoryMessages,
    base.currentUserMessage,
  ]
}
