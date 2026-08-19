import {
  activeLeafTurn,
  activeMessagePath,
  assistantTurnAlternatives,
  childThreadSourceProvenance,
} from "../core/selectors"
import type { ThreadTreeState } from "../core/types"
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
      const alternatives = latestTurn?.assistantMessage
        ? assistantTurnAlternatives(thread, latestTurn.assistantMessage.id).map(
            (assistant) => ({
              assistantMessageId: assistant.id,
              derivedThreadCount: thread.children.filter(
                (childId) =>
                  state.threads[childId]?.forkFromMsgId === assistant.id
              ).length,
            })
          )
        : []
      return [
        thread.id,
        {
          latestUserMessageId: latestTurn?.userMessage.id,
          latestAssistantMessageId: latestTurn?.assistantMessage?.id,
          alternatives,
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
