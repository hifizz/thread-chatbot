import type {
  Artifact,
  Message,
  Thread,
  ThreadTreeState,
} from "@/lib/thread-chat/domain/types"
import { THREAD_TREE_SCHEMA_VERSION } from "@/constants/thread-chat"

export class InvalidMessageGraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidMessageGraphError"
  }
}

function messageIndex(thread: Thread): Map<string, Message> {
  return new Map(thread.messages.map((message) => [message.id, message]))
}

function validateThreadGraph(thread: Thread): void {
  const byId = messageIndex(thread)
  if (byId.size !== thread.messages.length)
    throw new InvalidMessageGraphError(
      `Thread ${thread.id} contains duplicate message ids`
    )

  if (thread.messages.length === 0) {
    if (thread.activeLeafMessageId !== null)
      throw new InvalidMessageGraphError(
        `Empty thread ${thread.id} has an active leaf`
      )
    return
  }

  if (
    thread.activeLeafMessageId === null ||
    !byId.has(thread.activeLeafMessageId)
  )
    throw new InvalidMessageGraphError(
      `Thread ${thread.id} has a missing active leaf`
    )

  for (const message of thread.messages) {
    if (message.parentMessageId !== null && !byId.has(message.parentMessageId))
      throw new InvalidMessageGraphError(
        `Message ${message.id} has a missing parent`
      )

    const visited = new Set<string>()
    let cursor: Message | undefined = message
    while (cursor) {
      if (visited.has(cursor.id))
        throw new InvalidMessageGraphError(
          `Thread ${thread.id} contains a message cycle`
        )
      visited.add(cursor.id)
      cursor =
        cursor.parentMessageId === null
          ? undefined
          : byId.get(cursor.parentMessageId)
    }
  }
}

/** 严格解析 schema-v2 message graph；不迁移、不补字段、不猜测来源。 */
export function parseThreadTreeState(input: unknown): ThreadTreeState {
  if (typeof input !== "object" || input === null)
    throw new InvalidMessageGraphError("Thread tree state is not an object")

  const state = structuredClone(input) as ThreadTreeState & {
    schemaVersion?: number
    threads: Record<
      string,
      Omit<Thread, "messages" | "activeLeafMessageId"> & {
        messages: Array<
          Omit<Message, "parentMessageId"> & {
            parentMessageId?: string | null
          }
        >
        activeLeafMessageId?: string | null
      }
    >
    artifacts: Record<
      string,
      Omit<Artifact, "sourceMessageId"> & { sourceMessageId?: string }
    >
  }

  if (!state.threads || typeof state.threads !== "object")
    throw new InvalidMessageGraphError("Thread tree has no thread registry")

  if (state.schemaVersion !== THREAD_TREE_SCHEMA_VERSION)
    throw new InvalidMessageGraphError(
      `Thread tree schema must be ${THREAD_TREE_SCHEMA_VERSION}`
    )
  if (!state.artifacts || typeof state.artifacts !== "object")
    throw new InvalidMessageGraphError("Thread tree has no artifact registry")
  if (!Array.isArray(state.artifactOrder))
    throw new InvalidMessageGraphError("Thread tree has no artifact order")

  const artifactOwnerById = new Map<string, string>()
  const messageIds = new Set<string>()

  for (const thread of Object.values(state.threads)) {
    if (!Array.isArray(thread.messages))
      throw new InvalidMessageGraphError(`Thread ${thread.id} has no messages`)

    if (
      thread.messages.some(
        (message) => message.parentMessageId === undefined
      ) ||
      thread.activeLeafMessageId === undefined
    ) {
      throw new InvalidMessageGraphError(
        `Schema v2 thread ${thread.id} is missing graph fields`
      )
    }

    for (const message of thread.messages) {
      if (messageIds.has(message.id))
        throw new InvalidMessageGraphError(
          `Thread tree contains duplicate message id ${message.id}`
        )
      messageIds.add(message.id)
      for (const artifactId of message.artifactIds ?? []) {
        const priorOwner = artifactOwnerById.get(artifactId)
        if (priorOwner && priorOwner !== message.id)
          throw new InvalidMessageGraphError(
            `Artifact ${artifactId} has multiple source messages`
          )
        artifactOwnerById.set(artifactId, message.id)
      }
    }

    validateThreadGraph(thread as Thread)
  }

  for (const artifact of Object.values(state.artifacts)) {
    if (
      typeof artifact.sourceMessageId !== "string" ||
      artifact.sourceMessageId.length === 0
    )
      throw new InvalidMessageGraphError(
        `Artifact ${artifact.id} is missing its source message`
      )
    const sourceThread = state.threads[artifact.sourceThreadId]
    const sourceMessage = sourceThread?.messages.find(
      (message) => message.id === artifact.sourceMessageId
    )
    if (!sourceMessage || sourceMessage.role !== "assistant")
      throw new InvalidMessageGraphError(
        `Artifact ${artifact.id} has an invalid source message`
      )
    const discoveredOwner = artifactOwnerById.get(artifact.id)
    if (discoveredOwner !== artifact.sourceMessageId)
      throw new InvalidMessageGraphError(
        `Artifact ${artifact.id} is not referenced by its source message`
      )
  }

  return state as ThreadTreeState
}

/** 从根节点到指定节点的精确消息路径；无效图返回空数组。 */
export function messagePathTo(thread: Thread, messageId: string): Message[] {
  const byId = messageIndex(thread)
  const reversePath: Message[] = []
  const visited = new Set<string>()
  let cursor = byId.get(messageId)

  while (cursor) {
    if (visited.has(cursor.id)) return []
    visited.add(cursor.id)
    reversePath.push(cursor)
    if (cursor.parentMessageId === null) break
    cursor = byId.get(cursor.parentMessageId)
    if (!cursor) return []
  }

  return reversePath.reverse()
}

/** 当前 active leaf 对应的完整可见路径。 */
export function activeMessagePath(thread: Thread): Message[] {
  return thread.activeLeafMessageId === null
    ? []
    : messagePathTo(thread, thread.activeLeafMessageId)
}

/**
 * 一个最新问答轮的全部 assistant 版本：既包括同 user regenerate，
 * 也包括同一上游 parent 下 user edit 分支产生的 assistant。
 */
export function assistantTurnAlternatives(
  thread: Thread,
  assistantMessageId: string
): Message[] {
  const byId = messageIndex(thread)
  const assistant = byId.get(assistantMessageId)
  if (!assistant || assistant.role !== "assistant") return []
  const user =
    assistant.parentMessageId === null
      ? undefined
      : byId.get(assistant.parentMessageId)
  if (!user || user.role !== "user") return []

  const userParentId = user.parentMessageId
  const turnUsers = new Set(
    thread.messages
      .filter(
        (message) =>
          message.role === "user" && message.parentMessageId === userParentId
      )
      .map((message) => message.id)
  )
  return thread.messages.filter(
    (message) =>
      message.role === "assistant" &&
      message.parentMessageId !== null &&
      turnUsers.has(message.parentMessageId)
  )
}

/** message 是否属于当前 active path 的最后一轮。 */
export function isActiveLeafTurn(thread: Thread, messageId: string): boolean {
  if (thread.activeLeafMessageId === null) return false
  const byId = messageIndex(thread)
  const leaf = byId.get(thread.activeLeafMessageId)
  if (!leaf) return false
  if (leaf.id === messageId) return true
  return leaf.role === "assistant" && leaf.parentMessageId === messageId
}

export interface ActiveLeafTurn {
  userMessage: Message
  assistantMessage?: Message
}

/** 解析并验证 active leaf 的最后一轮 user/assistant 结构。 */
export function activeLeafTurn(thread: Thread): ActiveLeafTurn | null {
  if (thread.activeLeafMessageId === null) return null
  const byId = messageIndex(thread)
  const leaf = byId.get(thread.activeLeafMessageId)
  if (!leaf) return null
  if (leaf.role === "user") return { userMessage: leaf }
  const user =
    leaf.parentMessageId === null ? undefined : byId.get(leaf.parentMessageId)
  return user?.role === "user"
    ? { userMessage: user, assistantMessage: leaf }
    : null
}

export interface SourceProvenance {
  sourceThreadId: string
  sourceMessageId: string
  isOnActivePath: boolean
  alternativeIndex: number | null
  alternativeCount: number
}

/** 给子 Thread / Artifact 共用的精确来源版本状态。 */
export function sourceMessageProvenance(
  state: ThreadTreeState,
  sourceThreadId: string,
  sourceMessageId: string
): SourceProvenance {
  const thread = state.threads[sourceThreadId]
  if (!thread)
    return {
      sourceThreadId,
      sourceMessageId,
      isOnActivePath: false,
      alternativeIndex: null,
      alternativeCount: 0,
    }

  const activeIds = new Set(
    activeMessagePath(thread).map((message) => message.id)
  )
  const alternatives = assistantTurnAlternatives(thread, sourceMessageId)
  const alternativeIndex = alternatives.findIndex(
    (message) => message.id === sourceMessageId
  )
  return {
    sourceThreadId,
    sourceMessageId,
    isOnActivePath: activeIds.has(sourceMessageId),
    alternativeIndex: alternativeIndex < 0 ? null : alternativeIndex,
    alternativeCount: alternatives.length,
  }
}

export function childThreadSourceProvenance(
  state: ThreadTreeState,
  threadId: string
): SourceProvenance | null {
  const thread = state.threads[threadId]
  if (!thread?.parentId || !thread.forkFromMsgId) return null
  return sourceMessageProvenance(state, thread.parentId, thread.forkFromMsgId)
}

export function artifactSourceProvenance(
  state: ThreadTreeState,
  artifact: Artifact
): SourceProvenance {
  return sourceMessageProvenance(
    state,
    artifact.sourceThreadId,
    artifact.sourceMessageId
  )
}

/** 当前所有 Thread active path 上可默认展示的 Artifact。 */
export function activePathArtifacts(state: ThreadTreeState): Artifact[] {
  const activeMessageIds = new Set(
    Object.values(state.threads).flatMap((thread) =>
      activeMessagePath(thread).map((message) => message.id)
    )
  )
  return state.artifactOrder.flatMap((artifactId) => {
    const artifact = state.artifacts[artifactId]
    return artifact && activeMessageIds.has(artifact.sourceMessageId)
      ? [artifact]
      : []
  })
}
