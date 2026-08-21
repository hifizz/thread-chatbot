import type {
  ConversationSnapshot,
  MessageId,
  ThreadForkId,
  ThreadId,
  TurnId,
} from "../domain/conversation-model"

export interface ConversationReadIndexes {
  readonly forkIdsByParentThread: Readonly<
    Record<string, readonly ThreadForkId[]>
  >
  readonly childThreadIdsByParentThread: Readonly<
    Record<string, readonly ThreadId[]>
  >
  readonly turnIdsByThread: Readonly<Record<string, readonly TurnId[]>>
  readonly messageIdsByTurn: Readonly<Record<string, readonly MessageId[]>>
}

function append<T extends string>(
  target: Record<string, T[]>,
  key: string,
  value: T
): void {
  const values = target[key] ?? []
  values.push(value)
  target[key] = values
}

function sortValues<T extends string>(
  target: Record<string, T[]>
): Readonly<Record<string, readonly T[]>> {
  return Object.fromEntries(
    Object.entries(target)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, [...values].sort()])
  )
}

/** 从规范实体重建读取索引；返回值不是第二份可写领域事实。 */
export function deriveConversationReadIndexes(
  snapshot: ConversationSnapshot
): ConversationReadIndexes {
  const forkIdsByParentThread: Record<string, ThreadForkId[]> = {}
  const childThreadIdsByParentThread: Record<string, ThreadId[]> = {}
  const turnIdsByThread: Record<string, TurnId[]> = {}
  const messageIdsByTurn: Record<string, MessageId[]> = {}

  for (const fork of Object.values(snapshot.threadForks)) {
    append(forkIdsByParentThread, fork.parentThreadId, fork.id)
    append(
      childThreadIdsByParentThread,
      fork.parentThreadId,
      fork.childThreadId
    )
  }
  for (const turn of Object.values(snapshot.turns))
    append(turnIdsByThread, turn.threadId, turn.id)
  for (const message of Object.values(snapshot.messages))
    append(messageIdsByTurn, message.turnId, message.id)

  return {
    forkIdsByParentThread: sortValues(forkIdsByParentThread),
    childThreadIdsByParentThread: sortValues(childThreadIdsByParentThread),
    turnIdsByThread: sortValues(turnIdsByThread),
    messageIdsByTurn: sortValues(messageIdsByTurn),
  }
}
