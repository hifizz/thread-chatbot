import { migrateThreadTreeState } from "../core/message-graph"
import type { Message, ThreadTreeState } from "../core/types"
import { GENERATION_ERRORS } from "@/constants/generation"
import {
  isActiveGenerationStatus,
  type GenerationForReconcile,
  type ReconciledThreadChatTree,
  type RecoverableTurn,
} from "./types"
import { mergeGenerationResult, restoreTurnSnapshot } from "./merge-result"

const recoverableKey = (threadId: string, userMessageId: string) =>
  `${threadId}:${userMessageId}`

function parentUser(
  messages: readonly Message[],
  assistant: Message
): Message | undefined {
  return messages.find(
    (message) =>
      message.id === assistant.parentMessageId && message.role === "user"
  )
}

/**
 * 用 tree + current generation sidecar 得到唯一的加载投影。
 * 函数不修改输入，也不把协调结果反写 DB。
 */
export function reconcileThreadChatTurns(input: {
  state: ThreadTreeState
  generations: readonly GenerationForReconcile[]
}): ReconciledThreadChatTree {
  let state = migrateThreadTreeState(input.state)
  const currentGenerations = input.generations.filter(
    (generation) => generation.isCurrent
  )

  for (const generation of currentGenerations) {
    if (generation.result) {
      state = mergeGenerationResult(state, {
        threadId: generation.threadId,
        assistantMessageId: generation.assistantMessageId,
        generationId: generation.id,
        turnSnapshot: generation.turnSnapshot,
        result: generation.result,
      })
      continue
    }

    if (!isActiveGenerationStatus(generation.status)) continue
    const thread = state.threads[generation.threadId]
    if (!thread) continue
    let assistant = thread.messages.find(
      (message) => message.id === generation.assistantMessageId
    )
    if (!assistant) {
      const restored = restoreTurnSnapshot(thread, generation.turnSnapshot)
      assistant = restored?.assistantMessage
      if (
        restored &&
        (thread.activeLeafMessageId === null ||
          thread.activeLeafMessageId === restored.userMessage.id)
      )
        thread.activeLeafMessageId = restored.assistantMessage.id
    }
    if (assistant?.role === "assistant") {
      assistant.generationId = generation.id
      assistant.backgroundGeneration = true
      if (assistant.status !== "streaming") assistant.status = "pending"
      assistant.error = undefined
    }
  }

  const activeByAssistant = new Map(
    currentGenerations
      .filter((generation) => isActiveGenerationStatus(generation.status))
      .map((generation) => [
        `${generation.threadId}:${generation.assistantMessageId}`,
        generation,
      ])
  )
  const currentByUser = new Map(
    currentGenerations.map((generation) => [
      `${generation.threadId}:${generation.userMessageId}`,
      generation,
    ])
  )
  const recoverableByTurn = new Map<string, RecoverableTurn>()

  for (const thread of Object.values(state.threads)) {
    for (const message of thread.messages) {
      if (
        message.role !== "assistant" ||
        (message.status !== "pending" && message.status !== "streaming") ||
        message.text.trim() !== "" ||
        (message.artifactIds?.length ?? 0) > 0
      )
        continue

      if (activeByAssistant.has(`${thread.id}:${message.id}`)) continue
      const user = parentUser(thread.messages, message)
      if (!user) continue
      const generation = currentByUser.get(`${thread.id}:${user.id}`)
      message.status = "error"
      message.error = GENERATION_ERRORS.backgroundInterrupted
      message.backgroundGeneration = undefined
      recoverableByTurn.set(recoverableKey(thread.id, user.id), {
        threadId: thread.id,
        userMessageId: user.id,
        assistantMessageId: message.id,
        reason: generation ? "interrupted_generation" : "missing_generation",
      })
    }

    const activeLeaf = thread.messages.find(
      (message) => message.id === thread.activeLeafMessageId
    )
    if (activeLeaf?.role !== "user") continue
    const hasAssistantChild = thread.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.parentMessageId === activeLeaf.id
    )
    if (
      !hasAssistantChild &&
      !currentByUser.has(`${thread.id}:${activeLeaf.id}`)
    )
      recoverableByTurn.set(recoverableKey(thread.id, activeLeaf.id), {
        threadId: thread.id,
        userMessageId: activeLeaf.id,
        reason: "missing_assistant",
      })
  }

  return {
    state,
    recoverableTurns: [...recoverableByTurn.values()],
  }
}
