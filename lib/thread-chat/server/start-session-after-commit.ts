import type { GenerationAcceptedDTO } from "@/lib/thread-chat/contracts/dto"
import { getSessionStore } from "@/lib/thread-chat/streaming/session-store"
import { initialAssistantSnapshot } from "@/lib/thread-chat/streaming/stream-session"
import { runGeneration } from "@/lib/thread-chat/streaming/run-generation"

export function startSessionAfterCommit(
  userId: string,
  generation: GenerationAcceptedDTO
): boolean {
  const assistant = generation.assistantMessage
  return getSessionStore().start({
    messageId: assistant.id,
    initialSnapshot: initialAssistantSnapshot({
      messageId: assistant.id,
      threadId: assistant.threadId,
      modelId: assistant.modelId ?? undefined,
    }),
    run: (session) =>
      runGeneration({ userId, messageId: assistant.id, session }),
  }).started
}
