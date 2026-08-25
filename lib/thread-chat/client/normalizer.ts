import type {
  AssistantRunState,
  MessageEntity,
  ProjectArtifactSummary,
  ThreadEntity,
  ThreadId,
} from "./types"
import { clientInvariant } from "./errors"

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function normalizeThreads(input: {
  projectId: string
  current: Record<string, ThreadEntity>
  incoming: readonly ThreadEntity[]
}): Record<string, ThreadEntity> {
  const threads = { ...input.current }
  for (const thread of input.incoming) {
    clientInvariant(
      thread.projectId === input.projectId,
      "Thread belongs to another Project."
    )
    const existing = threads[thread.id]
    clientInvariant(
      !existing || sameValue(existing, thread),
      "Confirmed Thread identity changed."
    )
    threads[thread.id] = thread
  }
  for (const thread of Object.values(threads)) {
    if (thread.projectId !== input.projectId) continue
    if (thread.parentThreadId)
      clientInvariant(
        threads[thread.parentThreadId]?.projectId === input.projectId,
        "Thread parent is missing from Project topology."
      )
    const visited = new Set<string>()
    let cursor: ThreadEntity | undefined = thread
    while (cursor?.parentThreadId) {
      clientInvariant(
        !visited.has(cursor.id),
        "Thread topology contains a cycle."
      )
      visited.add(cursor.id)
      cursor = threads[cursor.parentThreadId]
    }
  }
  return threads
}

export function normalizeMessages(input: {
  threadId: ThreadId
  currentById: Record<string, MessageEntity>
  currentIdsByThread: Record<ThreadId, string[]>
  incoming: readonly MessageEntity[]
}): {
  messagesById: Record<string, MessageEntity>
  messageIdsByThreadId: Record<ThreadId, string[]>
} {
  const messagesById = { ...input.currentById }
  const ids = new Set(input.currentIdsByThread[input.threadId] ?? [])
  for (const message of input.incoming) {
    clientInvariant(
      message.threadId === input.threadId,
      "Message belongs to another Thread."
    )
    const existing = messagesById[message.id]
    if (existing) {
      clientInvariant(
        existing.threadId === message.threadId &&
          existing.sequence === message.sequence &&
          existing.role === message.role &&
          existing.replacesMessageId === message.replacesMessageId &&
          existing.createdAt === message.createdAt,
        "Confirmed Message identity changed."
      )
      if (existing.finalizedAt)
        clientInvariant(
          existing.finalizedAt === message.finalizedAt &&
            sameValue(existing.parts, message.parts),
          "Finalized Message content changed."
        )
      if (existing.supersededAt)
        clientInvariant(
          existing.supersededAt === message.supersededAt,
          "Message supersededAt changed."
        )
    }
    messagesById[message.id] = message
    ids.add(message.id)
  }
  const sortedIds = [...ids].toSorted((leftId, rightId) => {
    const left = messagesById[leftId]
    const right = messagesById[rightId]
    return left.sequence - right.sequence || left.id.localeCompare(right.id)
  })
  for (let index = 1; index < sortedIds.length; index++)
    clientInvariant(
      messagesById[sortedIds[index - 1]].sequence !==
        messagesById[sortedIds[index]].sequence,
      "Thread contains duplicate Message sequence."
    )
  return {
    messagesById,
    messageIdsByThreadId: {
      ...input.currentIdsByThread,
      [input.threadId]: sortedIds,
    },
  }
}

export function normalizeRuns(input: {
  current: Record<string, AssistantRunState>
  incoming: readonly AssistantRunState[]
  messagesById: Record<string, MessageEntity>
}): Record<string, AssistantRunState> {
  const runs = { ...input.current }
  for (const run of input.incoming) {
    const message = input.messagesById[run.assistantMessageId]
    clientInvariant(
      message?.role === "assistant",
      "Assistant Run does not reference an assistant Message."
    )
    const existing = runs[run.assistantMessageId]
    if (existing) {
      clientInvariant(
        run.eventSequence >= existing.eventSequence,
        "Assistant Run eventSequence moved backwards."
      )
      clientInvariant(
        run.modelId === existing.modelId,
        "Assistant Run model identity changed."
      )
      const existingTerminal = ["completed", "failed", "stopped"].includes(
        existing.status
      )
      if (existingTerminal)
        clientInvariant(
          sameValue(existing, run),
          "Terminal Assistant Run changed."
        )
      if (run.eventSequence === existing.eventSequence) {
        clientInvariant(
          existing.status === run.status ||
            (existing.status === "queued" && run.status === "running"),
          "Assistant Run status changed without a valid transition."
        )
        clientInvariant(
          existing.stopRequestedAt === null ||
            existing.stopRequestedAt === run.stopRequestedAt,
          "Assistant Run stop request moved backwards."
        )
      }
    }
    runs[run.assistantMessageId] = run
  }
  return runs
}

export function mergeArtifactSummary(
  current: ProjectArtifactSummary | null,
  incoming: ProjectArtifactSummary
): ProjectArtifactSummary {
  if (!current || incoming.changeSequence > current.changeSequence)
    return incoming
  if (incoming.changeSequence < current.changeSequence) return current
  clientInvariant(
    sameValue(current, incoming),
    "Artifact Summary changed without advancing changeSequence."
  )
  return current
}
