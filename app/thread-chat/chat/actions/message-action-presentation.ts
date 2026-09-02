import {
  activeLeafTurn,
  activeMessagePath,
  childThreadSourceProvenance,
} from "../../core/selectors"
import type { ThreadTreeState } from "../../core/types"
import type { MessageActionViewState } from "./message-action-types"

export function buildMessageActionViewState({
  state,
  recoverableByUserMessageId,
  feedbackByMessageId,
}: {
  state: ThreadTreeState
  recoverableByUserMessageId: MessageActionViewState["recoverableByUserMessageId"]
  feedbackByMessageId: MessageActionViewState["feedbackByMessageId"]
}): MessageActionViewState {
  const activePathByThreadId = new Map(
    Object.values(state.threads).map((thread) => [
      thread.id,
      activeMessagePath(thread).map((message) => message.id),
    ])
  )
  const presentationByThreadId = new Map(
    Object.values(state.threads).map((thread) => {
      const latestTurn = activeLeafTurn(thread)
      return [
        thread.id,
        {
          latestUserMessageId: latestTurn?.userMessage.id,
          latestAssistantMessageId: latestTurn?.assistantMessage?.id,
          sourceProvenance: childThreadSourceProvenance(state, thread.id),
        },
      ] as const
    })
  )

  return {
    recoverableByUserMessageId,
    feedbackByMessageId,
    activePathByThreadId,
    presentationByThreadId,
  }
}
