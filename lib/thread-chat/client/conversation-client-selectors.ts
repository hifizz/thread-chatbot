import type {
  ConversationId,
  ConversationMessage,
  MessageId,
  ThreadFork,
  ThreadForkId,
  ThreadId,
  TurnId,
} from "../domain/conversation-model"
import type { CanonicalClientState } from "./normalized-conversation-store"

export interface ConversationCanvasEdge {
  readonly id: string
  readonly source: ThreadId
  readonly target: ThreadId
  readonly forkId: ThreadForkId
  readonly sourceMessageId: MessageId
}

export interface ConversationDerivedIndexes {
  readonly threadIdsByConversation: Readonly<
    Record<string, readonly ThreadId[]>
  >
  readonly incomingForkByThread: Readonly<Record<string, ThreadFork>>
  readonly outgoingForkIdsByThread: Readonly<
    Record<string, readonly ThreadForkId[]>
  >
  readonly childThreadIdsByParentThread: Readonly<
    Record<string, readonly ThreadId[]>
  >
  readonly turnIdsByThread: Readonly<Record<string, readonly TurnId[]>>
  readonly messageIdsByTurn: Readonly<Record<string, readonly MessageId[]>>
  readonly depthByThread: Readonly<Record<string, number>>
  readonly contextMessageIdsByThread: Readonly<
    Record<string, readonly MessageId[]>
  >
  readonly canvasEdges: readonly ConversationCanvasEdge[]
}

let derivedCache = new WeakMap<
  CanonicalClientState,
  ConversationDerivedIndexes
>()

function append<T extends string>(
  registry: Record<string, T[]>,
  key: string,
  value: T
) {
  const values = registry[key] ?? []
  values.push(value)
  registry[key] = values
}

function freezeArrays<T extends string>(
  registry: Record<string, T[]>,
  compare?: (left: T, right: T) => number
): Readonly<Record<string, readonly T[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(registry).map(([key, values]) => [
        key,
        Object.freeze([...values].sort(compare)),
      ])
    )
  )
}

export function deriveConversationClientIndexes(
  state: CanonicalClientState
): ConversationDerivedIndexes {
  const cached = derivedCache.get(state)
  if (cached) return cached

  const threadIdsByConversation: Record<string, ThreadId[]> = {}
  const incomingForkByThread: Record<string, ThreadFork> = {}
  const outgoingForkIdsByThread: Record<string, ThreadForkId[]> = {}
  const childThreadIdsByParentThread: Record<string, ThreadId[]> = {}
  const turnIdsByThread: Record<string, TurnId[]> = {}
  const messageIdsByTurn: Record<string, MessageId[]> = {}

  for (const thread of Object.values(state.threadsById))
    append(threadIdsByConversation, thread.conversationId, thread.id)
  for (const fork of Object.values(state.threadForksById)) {
    incomingForkByThread[fork.childThreadId] = fork
    append(outgoingForkIdsByThread, fork.parentThreadId, fork.id)
    append(
      childThreadIdsByParentThread,
      fork.parentThreadId,
      fork.childThreadId
    )
  }
  const turns = Object.values(state.turnsById).sort(
    (left, right) =>
      left.position - right.position || left.id.localeCompare(right.id)
  )
  for (const turn of turns) append(turnIdsByThread, turn.threadId, turn.id)
  const messages = Object.values(state.messagesById).sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  )
  for (const message of messages)
    append(messageIdsByTurn, message.turnId, message.id)

  const frozenTurns = freezeArrays(turnIdsByThread, (left, right) => {
    const a = state.turnsById[left]
    const b = state.turnsById[right]
    return (a?.position ?? 0) - (b?.position ?? 0) || left.localeCompare(right)
  })
  const frozenMessages = freezeArrays(messageIdsByTurn, (left, right) => {
    const a = state.messagesById[left]
    const b = state.messagesById[right]
    return (
      (a?.createdAt ?? "").localeCompare(b?.createdAt ?? "") ||
      left.localeCompare(right)
    )
  })

  const localActiveMessages = (targetThreadId: ThreadId): MessageId[] =>
    (frozenTurns[targetThreadId] ?? []).flatMap((targetTurnId) => {
      const turn = state.turnsById[targetTurnId]
      return turn
        ? [turn.activeUserMessageId, turn.activeAssistantMessageId]
        : []
    })

  const localThroughSource = (
    targetThreadId: ThreadId,
    sourceMessageId: MessageId
  ): readonly MessageId[] => {
    const source = state.messagesById[sourceMessageId]
    const sourceTurn = source ? state.turnsById[source.turnId] : undefined
    if (!source || !sourceTurn || source.threadId !== targetThreadId) return []
    const before = (frozenTurns[targetThreadId] ?? [])
      .map((id) => state.turnsById[id])
      .filter(
        (turn): turn is NonNullable<typeof turn> =>
          Boolean(turn) && turn.position < sourceTurn.position
      )
      .flatMap((turn) => [
        turn.activeUserMessageId,
        turn.activeAssistantMessageId,
      ])
    if (source.role === "user") return [...before, source.id]
    const generation = Object.values(state.generationsById).find(
      (candidate) => candidate.outputMessageId === source.id
    )
    return [
      ...before,
      generation?.inputMessageId ?? sourceTurn.activeUserMessageId,
      source.id,
    ]
  }

  const contextMemo = new Map<ThreadId, readonly MessageId[]>()
  const contextOf = (targetThreadId: ThreadId): readonly MessageId[] => {
    const cachedContext = contextMemo.get(targetThreadId)
    if (cachedContext) return cachedContext
    const fork = incomingForkByThread[targetThreadId]
    let inherited: readonly MessageId[] = []
    if (fork) {
      const parentFork = incomingForkByThread[fork.parentThreadId]
      const parentInherited = parentFork
        ? contextOf(fork.parentThreadId).slice(
            0,
            contextOf(fork.parentThreadId).length -
              localActiveMessages(fork.parentThreadId).length
          )
        : []
      inherited = [
        ...parentInherited,
        ...localThroughSource(fork.parentThreadId, fork.sourceMessageId),
      ]
    }
    const value = Object.freeze([
      ...inherited,
      ...localActiveMessages(targetThreadId),
    ])
    contextMemo.set(targetThreadId, value)
    return value
  }

  const depthByThread: Record<string, number> = {}
  const depthOf = (targetThreadId: ThreadId): number => {
    if (depthByThread[targetThreadId] !== undefined)
      return depthByThread[targetThreadId]!
    const parent = incomingForkByThread[targetThreadId]?.parentThreadId
    const depth = parent ? depthOf(parent) + 1 : 0
    depthByThread[targetThreadId] = depth
    return depth
  }
  for (const thread of Object.values(state.threadsById)) {
    depthOf(thread.id)
    contextOf(thread.id)
  }

  const canvasEdges = Object.values(state.threadForksById)
    .map((fork) => ({
      id: `fork-edge:${fork.id}`,
      source: fork.parentThreadId,
      target: fork.childThreadId,
      forkId: fork.id,
      sourceMessageId: fork.sourceMessageId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  const derived = Object.freeze({
    threadIdsByConversation: freezeArrays(threadIdsByConversation),
    incomingForkByThread: Object.freeze(incomingForkByThread),
    outgoingForkIdsByThread: freezeArrays(outgoingForkIdsByThread),
    childThreadIdsByParentThread: freezeArrays(childThreadIdsByParentThread),
    turnIdsByThread: frozenTurns,
    messageIdsByTurn: frozenMessages,
    depthByThread: Object.freeze(depthByThread),
    contextMessageIdsByThread: Object.freeze(
      Object.fromEntries(contextMemo.entries())
    ),
    canvasEdges: Object.freeze(canvasEdges),
  })
  derivedCache.set(state, derived)
  return derived
}

export function clearConversationDerivedCache(): void {
  derivedCache = new WeakMap()
}

export function selectConversation(
  state: CanonicalClientState,
  targetId: ConversationId
) {
  return state.conversationsById[targetId]
}

export function selectRootThreadId(
  state: CanonicalClientState,
  targetId: ConversationId
): ThreadId | null {
  return state.conversationsById[targetId]?.rootThreadId ?? null
}

export function selectThreadTitle(
  state: CanonicalClientState,
  targetThreadId: ThreadId
): string {
  const thread = state.threadsById[targetThreadId]
  if (!thread) return ""
  const conversation = state.conversationsById[thread.conversationId]
  return thread.id === conversation?.rootThreadId
    ? (conversation.customTitle ?? conversation.autoTitle ?? "新对话")
    : (thread.localTitle ?? "未命名分支")
}

export function selectThreadMessages(
  state: CanonicalClientState,
  targetThreadId: ThreadId,
  includeInherited = false
): readonly ConversationMessage[] {
  const indexes = deriveConversationClientIndexes(state)
  const ids = includeInherited
    ? (indexes.contextMessageIdsByThread[targetThreadId] ?? [])
    : (indexes.turnIdsByThread[targetThreadId] ?? []).flatMap(
        (targetTurnId) => {
          const turn = state.turnsById[targetTurnId]
          return turn
            ? [turn.activeUserMessageId, turn.activeAssistantMessageId]
            : []
        }
      )
  return ids.flatMap((targetMessageId) => {
    const message = state.messagesById[targetMessageId]
    return message ? [message] : []
  })
}

export function selectThreadLineage(
  state: CanonicalClientState,
  targetThreadId: ThreadId
): readonly ThreadId[] {
  const indexes = deriveConversationClientIndexes(state)
  const lineage: ThreadId[] = []
  let cursor: ThreadId | undefined = targetThreadId
  while (cursor) {
    lineage.push(cursor)
    cursor = indexes.incomingForkByThread[cursor]?.parentThreadId
  }
  return lineage.reverse()
}

export function selectForkCount(
  state: CanonicalClientState,
  targetThreadId: ThreadId
): number {
  return (
    deriveConversationClientIndexes(state).outgoingForkIdsByThread[
      targetThreadId
    ]?.length ?? 0
  )
}
