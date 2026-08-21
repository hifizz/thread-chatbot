import { streamText } from "ai"

import { MAX_OUTPUT_TOKENS } from "@/constants/model"
import { resolveChatModel } from "@/lib/ai/provider"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"

import type { ConversationQueryPort } from "../application/conversation-command-service"
import type { ConversationSnapshotResult } from "../application/conversation-command-contracts"
import type {
  CanonicalGenerationExecutor,
  CanonicalGenerationRecord,
} from "../application/conversation-generation-service"
import {
  emptyConversationGenerationCheckpoint,
  type KnownGenerationUsage,
} from "../domain/conversation-generation"

function messageText(
  parts: readonly { readonly type: string; readonly text?: string }[]
) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
}

/**
 * 把规范读取投影编译成一次模型调用的消息序列。
 * 重新生成较早 Turn 时，必须保留继承上下文，但排除同一 Thread 的后续 Turn。
 */
export function compileCanonicalGenerationMessages(input: {
  readonly loaded: ConversationSnapshotResult
  readonly generation: Pick<
    CanonicalGenerationRecord,
    "threadId" | "turnId" | "outputMessageId"
  >
}) {
  const ids =
    input.loaded.contextMessageIdsByThread[input.generation.threadId] ?? []
  const targetTurn = input.loaded.snapshot.turns[input.generation.turnId]
  if (!targetTurn) throw new Error("Generation 目标 Turn 不存在")
  return ids.flatMap((id) => {
    if (id === input.generation.outputMessageId) return []
    const message = input.loaded.snapshot.messages[id]
    if (!message || message.role === "context") return []
    const turn = input.loaded.snapshot.turns[message.turnId]
    if (
      message.threadId === input.generation.threadId &&
      turn &&
      turn.position > targetTurn.position
    )
      return []
    const content = messageText(message.content.parts)
    return content.trim() ? [{ role: message.role, content } as const] : []
  })
}

/** 公开 canonical 组合根使用的模型 executor；上下文只从服务端规范快照编译。 */
export class CanonicalAiGenerationExecutor implements CanonicalGenerationExecutor {
  constructor(private readonly queries: ConversationQueryPort) {}

  async execute(input: Parameters<CanonicalGenerationExecutor["execute"]>[0]) {
    const loaded = await this.queries.getConversationSnapshot({
      actorUserId: input.generation.ownerId,
      conversationId: input.generation.conversationId,
    })
    if (!loaded) throw new Error("Conversation 在 Generation 执行前不可读取")
    const messages = compileCanonicalGenerationMessages({
      loaded,
      generation: input.generation,
    })
    const incomingFork = Object.values(loaded.snapshot.threadForks).find(
      (fork) => fork.childThreadId === input.generation.threadId
    )
    const model = resolveChatModel(input.generation.modelId)
    const result = streamText({
      model,
      system: buildThreadChatSystem(incomingFork?.anchor?.quote.exact ?? null),
      messages,
      abortSignal: input.signal,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
    let body = ""
    for await (const delta of result.textStream) {
      body += delta
      await input.onCheckpoint({
        ...emptyConversationGenerationCheckpoint(),
        body,
        contentState: "streaming",
      })
    }
    const usage = await result.totalUsage
    const knownUsage: KnownGenerationUsage | null =
      usage.inputTokens !== undefined && usage.outputTokens !== undefined
        ? {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            paidStepCount: 1,
            reportedStepCount: 1,
          }
        : null
    return {
      outcome: "completed" as const,
      checkpoint: {
        ...emptyConversationGenerationCheckpoint(),
        body,
        contentState: "complete" as const,
        knownUsage,
      },
      usageCompleteness: knownUsage
        ? ("complete" as const)
        : ("unavailable" as const),
      knownUsage,
    }
  }
}
