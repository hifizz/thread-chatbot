/**
 * 兼容入口：Thread Chat headless selectors 位于 lib/thread-chat/domain。
 */
export * from "@/lib/thread-chat/domain/selectors"

import type {
  ArtifactDTO,
  MessageDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { NormalizedThreadChatState } from "./types"
import {
  canEditLatestUserTurn,
  canRetryLatestAssistant,
} from "@/lib/thread-chat/domain/timeline"

function orderedMessages(
  state: NormalizedThreadChatState,
  threadId: string
): MessageDTO[] {
  return (state.messageIdsByThread[threadId] ?? []).flatMap((id) => {
    const message = state.messagesById[id]
    return message ? [message] : []
  })
}

export function selectVisibleMessages(
  state: NormalizedThreadChatState,
  threadId: string
): MessageDTO[] {
  return orderedMessages(state, threadId)
    .filter((message) => message.supersededAt === null)
    .map((message) => {
      const live = state.streamByMessageId[message.id]?.liveMessage
      return live ? { ...message, parts: live.parts } : message
    })
}

export function selectAllMessageEntities(
  state: NormalizedThreadChatState,
  threadId: string
): MessageDTO[] {
  return orderedMessages(state, threadId)
}

export function selectChildren(
  state: NormalizedThreadChatState,
  threadId: string
): ThreadDTO[] {
  return Object.values(state.threadsById)
    .filter((thread) => thread.parentId === threadId)
    .sort((left, right) => (left.footnote ?? 0) - (right.footnote ?? 0))
}

export function selectLineage(
  state: NormalizedThreadChatState,
  threadId: string
): ThreadDTO[] {
  const result: ThreadDTO[] = []
  const visited = new Set<string>()
  let current: ThreadDTO | undefined = state.threadsById[threadId]
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    result.unshift(current)
    current = current.parentId ? state.threadsById[current.parentId] : undefined
  }
  return result
}

export function selectThreadTree(state: NormalizedThreadChatState): ThreadDTO[] {
  const rootId = state.project?.rootThreadId
  if (!rootId) return []
  const result: ThreadDTO[] = []
  const walk = (threadId: string) => {
    const thread = state.threadsById[threadId]
    if (!thread) return
    result.push(thread)
    for (const child of selectChildren(state, thread.id)) walk(child.id)
  }
  walk(rootId)
  return result
}

export function selectForkMarkers(
  state: NormalizedThreadChatState,
  messageId: string
): ThreadDTO[] {
  return Object.values(state.threadsById)
    .filter((thread) => thread.forkMessageId === messageId)
    .sort((left, right) => (left.footnote ?? 0) - (right.footnote ?? 0))
}

export function selectSourceProvenance(
  state: NormalizedThreadChatState,
  threadId: string
): { thread: ThreadDTO; message: MessageDTO | null } | null {
  const thread = state.threadsById[threadId]
  if (!thread || !thread.forkMessageId) return null
  return { thread, message: state.messagesById[thread.forkMessageId] ?? null }
}

export function selectArtifactsForMessage(
  state: NormalizedThreadChatState,
  messageId: string
): ArtifactDTO[] {
  return state.artifactOrder.flatMap((id) => {
    const artifact = state.artifactsById[id]
    return artifact?.sourceMessageId === messageId ? [artifact] : []
  })
}

export function selectArtifactsForProject(
  state: NormalizedThreadChatState
): ArtifactDTO[] {
  return state.artifactOrder.flatMap((id) => {
    const artifact = state.artifactsById[id]
    return artifact ? [artifact] : []
  })
}

export function selectDisplayTitle(
  value: Pick<ThreadDTO, "id" | "customTitle" | "autoTitle">
): string {
  return value.customTitle ?? value.autoTitle ?? value.id
}

export function selectThreadBusy(
  state: NormalizedThreadChatState,
  threadId: string
): boolean {
  return selectVisibleMessages(state, threadId).some(
    (message) => message.role === "assistant" && message.status === "generating"
  )
}

export function selectMessageActions(
  state: NormalizedThreadChatState,
  threadId: string,
  messageId: string
): {
  canEdit: boolean
  canRetry: boolean
  canStop: boolean
  canFeedback: boolean
} {
  const messages = selectAllMessageEntities(state, threadId)
  const message = state.messagesById[messageId]
  return {
    canEdit:
      message?.role === "user" &&
      canEditLatestUserTurn(messages, messageId),
    canRetry:
      message?.role === "assistant" &&
      canRetryLatestAssistant(messages, messageId),
    canStop:
      message?.role === "assistant" && message.status === "generating",
    canFeedback:
      message?.role === "assistant" && message.status === "completed",
  }
}
