"use client"

import { useCallback, useMemo, useState } from "react"
import type { MessageFeedbackSummary, ThreadTreeState } from "../../core/types"
import type { RecoverableTurn } from "../../generation/types"
import type { ThreadMessageActionCommands } from "./message-action-commands"
import { buildMessageActionViewState } from "./message-action-presentation"
import {
  indexMessageFeedbacks,
  indexRecoverableTurns,
  withMessageFeedback,
  withRecoverableTurn,
  withoutRecoverableTurn,
} from "./message-action-session-logic"

export function useMessageActions({
  state,
  version,
  initialRecoverableTurns,
  initialMessageFeedbacks,
  commands,
}: {
  state: ThreadTreeState
  version: number
  initialRecoverableTurns: RecoverableTurn[]
  initialMessageFeedbacks: MessageFeedbackSummary[]
  commands: ThreadMessageActionCommands
}) {
  const [recoverableByUserMessageId, setRecoverableByUserMessageId] = useState(
    () => indexRecoverableTurns(initialRecoverableTurns)
  )
  const [feedbackByMessageId, setFeedbackByMessageId] = useState(() =>
    indexMessageFeedbacks(initialMessageFeedbacks)
  )

  const messageActionState = useMemo(
    () =>
      buildMessageActionViewState({
        state,
        recoverableByUserMessageId,
        feedbackByMessageId,
      }),
    // state 对象原地变更，必须用 store version 作为派生键。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recoverableByUserMessageId, feedbackByMessageId, version]
  )

  const messageCommands = useMemo<ThreadMessageActionCommands>(
    () => ({
      retryAssistant: commands.retryAssistant,
      async retryUserTurn(threadId, userMessageId) {
        const result = await commands.retryUserTurn(threadId, userMessageId)
        if (result.ok)
          setRecoverableByUserMessageId((current) =>
            withoutRecoverableTurn(current, userMessageId)
          )
        return result
      },
      async editAndRegenerate(threadId, userMessageId, text) {
        const result = await commands.editAndRegenerate(
          threadId,
          userMessageId,
          text
        )
        if (result.ok)
          setRecoverableByUserMessageId((current) =>
            withoutRecoverableTurn(current, userMessageId)
          )
        return result
      },
      async submitFeedback(threadId, messageId, feedback) {
        const previous = feedbackByMessageId.get(messageId) ?? null
        setFeedbackByMessageId((current) =>
          withMessageFeedback(current, messageId, feedback)
        )
        try {
          return await commands.submitFeedback(threadId, messageId, feedback)
        } catch (error) {
          setFeedbackByMessageId((current) =>
            withMessageFeedback(current, messageId, previous)
          )
          throw error
        }
      },
    }),
    [commands, feedbackByMessageId]
  )

  const registerRecoverableTurn = useCallback(
    (turn: RecoverableTurn) =>
      setRecoverableByUserMessageId((current) =>
        withRecoverableTurn(current, turn)
      ),
    []
  )

  return {
    messageActionState,
    messageCommands,
    registerRecoverableTurn,
  }
}
