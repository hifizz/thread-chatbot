import type { ThreadTreeState } from "../core/types"
import {
  prepareRegenerationPatch,
  type PreparedTurnPatch,
} from "../core/regeneration"
import type { ThreadChatGenerationIntent } from "../generation/types"
import type { GenerationActionResult } from "./message-action-results"

export type PreparedRegenerationAction = {
  intent: Exclude<ThreadChatGenerationIntent, { kind: "persisted-turn" }>
  patch: PreparedTurnPatch
  sourceUserMessageId?: string
  sourceAssistantMessageId?: string
}

export type PreparedRegenerationStart = {
  threadId: string
  messageId: string
  userMessageId: string
  generationId: string
  action: PreparedRegenerationAction
}

export type RegenerationPreparationResult =
  | { ok: true; start: PreparedRegenerationStart }
  | Extract<GenerationActionResult, { ok: false }>

/** 为“重新生成 assistant”准备纯追加 patch 与启动参数，不修改 store。 */
export function prepareAssistantRetry(
  state: ThreadTreeState,
  input: {
    threadId: string
    sourceAssistantMessageId: string
    assistantMessageId: string
    generationId: string
  }
): RegenerationPreparationResult {
  const thread = state.threads[input.threadId]
  const source = thread?.messages.find(
    (message) => message.id === input.sourceAssistantMessageId
  )
  if (!thread || source?.role !== "assistant" || !source.parentMessageId) {
    return { ok: false, code: "not_found", message: "回复不存在" }
  }

  const intent = {
    kind: "regenerate-assistant" as const,
    sourceAssistantMessageId: input.sourceAssistantMessageId,
  }
  const patch = prepareRegenerationPatch(state, {
    threadId: input.threadId,
    userMessageId: source.parentMessageId,
    assistantMessageId: input.assistantMessageId,
    generationId: input.generationId,
    intent,
  })
  if (!patch) {
    return {
      ok: false,
      code: "not_latest_turn",
      message: "只能重新生成当前最后一轮回复",
    }
  }

  return {
    ok: true,
    start: {
      threadId: input.threadId,
      messageId: input.assistantMessageId,
      userMessageId: source.parentMessageId,
      generationId: input.generationId,
      action: {
        intent,
        patch,
        sourceAssistantMessageId: input.sourceAssistantMessageId,
      },
    },
  }
}
