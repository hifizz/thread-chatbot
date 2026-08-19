import { activeLeafTurn } from "./message-graph"
import type { Message, ThreadTreeState } from "./types"
import type { ThreadChatGenerationIntent } from "./generation"

export interface PrepareRegenerationInput {
  threadId: string
  userMessageId: string
  assistantMessageId: string
  generationId: string
  intent: Exclude<ThreadChatGenerationIntent, { kind: "persisted-turn" }>
}

export interface PreparedTurnPatch {
  threadId: string
  addedMessages: readonly Message[]
  nextActiveLeafMessageId: string
  supersededGenerationId?: string
}

function messageIdExists(state: ThreadTreeState, messageId: string): boolean {
  return Object.values(state.threads).some((thread) =>
    thread.messages.some((message) => message.id === messageId)
  )
}

function pendingAssistant(input: {
  id: string
  parentMessageId: string
  generationId: string
}): Message {
  return {
    id: input.id,
    parentMessageId: input.parentMessageId,
    role: "assistant",
    text: "",
    forks: [],
    generationId: input.generationId,
    status: "pending",
  }
}

/**
 * 为最新一轮构造只追加的变体 patch。返回 null 表示来源不是最新轮、
 * ID 冲突或结构不合法；函数不修改 state/source node/Artifact。
 */
export function prepareRegenerationPatch(
  state: ThreadTreeState,
  input: PrepareRegenerationInput
): PreparedTurnPatch | null {
  const thread = state.threads[input.threadId]
  if (!thread) return null
  const latest = activeLeafTurn(thread)
  if (!latest) return null

  if (
    messageIdExists(state, input.assistantMessageId) ||
    (input.intent.kind === "edit-last-user" &&
      messageIdExists(state, input.userMessageId))
  )
    return null

  if (input.intent.kind === "regenerate-assistant") {
    if (
      latest.assistantMessage?.id !== input.intent.sourceAssistantMessageId ||
      latest.userMessage.id !== input.userMessageId
    )
      return null
    return {
      threadId: input.threadId,
      addedMessages: [
        pendingAssistant({
          id: input.assistantMessageId,
          parentMessageId: latest.userMessage.id,
          generationId: input.generationId,
        }),
      ],
      nextActiveLeafMessageId: input.assistantMessageId,
      ...(latest.assistantMessage.generationId &&
      (latest.assistantMessage.status === "pending" ||
        latest.assistantMessage.status === "streaming")
        ? { supersededGenerationId: latest.assistantMessage.generationId }
        : {}),
    }
  }

  if (input.intent.kind === "retry-orphan-user") {
    if (latest.userMessage.id !== input.userMessageId) return null
    if (
      latest.assistantMessage &&
      (latest.assistantMessage.text.trim() !== "" ||
        (latest.assistantMessage.artifactIds?.length ?? 0) > 0 ||
        latest.assistantMessage.status !== "error")
    )
      return null
    return {
      threadId: input.threadId,
      addedMessages: [
        pendingAssistant({
          id: input.assistantMessageId,
          parentMessageId: latest.userMessage.id,
          generationId: input.generationId,
        }),
      ],
      nextActiveLeafMessageId: input.assistantMessageId,
    }
  }

  if (
    latest.userMessage.id !== input.intent.sourceUserMessageId ||
    input.intent.text.trim() === ""
  )
    return null
  const editedUser: Message = {
    id: input.userMessageId,
    parentMessageId: latest.userMessage.parentMessageId,
    role: "user",
    text: input.intent.text.trim(),
    forks: [],
    ...(latest.userMessage.quote
      ? { quote: structuredClone(latest.userMessage.quote) }
      : {}),
  }
  return {
    threadId: input.threadId,
    addedMessages: [
      editedUser,
      pendingAssistant({
        id: input.assistantMessageId,
        parentMessageId: editedUser.id,
        generationId: input.generationId,
      }),
    ],
    nextActiveLeafMessageId: input.assistantMessageId,
    ...(latest.assistantMessage?.generationId &&
    (latest.assistantMessage.status === "pending" ||
      latest.assistantMessage.status === "streaming")
      ? { supersededGenerationId: latest.assistantMessage.generationId }
      : {}),
  }
}
