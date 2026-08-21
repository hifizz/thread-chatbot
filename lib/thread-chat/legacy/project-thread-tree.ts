/**
 * 遗留 ThreadTreeState 的单向只读投影边界。
 *
 * 只有迁移、审计和固定样例可以依赖本模块。这里故意不提供规范实体写回遗留树的
 * 反向函数，避免在迁移期间形成第二个写入权威。
 */
import {
  CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
  LEGACY_PROJECTION_UNKNOWN_TIMESTAMP,
} from "../../../constants/conversation-domain.ts"
import {
  activeMessagePath,
  parseThreadTreeState,
} from "../domain/message-graph.ts"
import type {
  Artifact as LegacyArtifact,
  Message as LegacyMessage,
  Thread as LegacyThread,
  ThreadTreeState,
} from "../domain/types.ts"
import {
  artifactId,
  messageId,
  threadForkId,
  threadId,
  turnId,
  type ArtifactId,
  type ConversationArtifactProvenance,
  type ConversationId,
  type ConversationMessage,
  type ConversationSnapshot,
  type ConversationThread,
  type ConversationTurn,
  type MessageContentState,
  type MessageId,
  type ProjectId,
  type ThreadFork,
  type ThreadId,
  type TurnId,
  type WorkspaceId,
} from "../domain/conversation-model.ts"
import { assertValidConversationSnapshot } from "../domain/conversation-validation.ts"

export class LegacyThreadTreeProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LegacyThreadTreeProjectionError"
  }
}

export interface ProjectLegacyThreadTreeInput {
  readonly legacyTreeId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly conversationId: ConversationId
  readonly projectTitle: string
  readonly conversationAutoTitle: string | null
  readonly conversationCustomTitle: string | null
  readonly actorId: string
  readonly state: ThreadTreeState
}

export interface LegacyIdMap {
  readonly thread: (legacyId: string) => ThreadId
  readonly message: (legacyId: string) => MessageId
  readonly turn: (legacyThreadId: string, groupKey: string) => TurnId
  readonly fork: (
    legacyChildThreadId: string
  ) => ReturnType<typeof threadForkId>
  readonly artifact: (legacyId: string) => ArtifactId
}

function legacySegment(value: string): string {
  return encodeURIComponent(value)
}

export function createLegacyIdMap(input: {
  readonly legacyTreeId: string
  readonly conversationId: ConversationId
}): LegacyIdMap {
  const prefix = `legacy:${legacySegment(input.legacyTreeId)}:${input.conversationId}`
  return {
    thread: (legacyId) =>
      threadId(
        `${prefix}:thread:${legacyId === "main" ? "root" : legacySegment(legacyId)}`
      ),
    message: (legacyId) =>
      messageId(`${prefix}:message:${legacySegment(legacyId)}`),
    turn: (legacyThreadId, groupKey) =>
      turnId(
        `${prefix}:turn:${legacySegment(legacyThreadId)}:${legacySegment(groupKey)}`
      ),
    fork: (legacyChildThreadId) =>
      threadForkId(`${prefix}:fork:${legacySegment(legacyChildThreadId)}`),
    artifact: (legacyId) =>
      artifactId(`${prefix}:artifact:${legacySegment(legacyId)}`),
  }
}

function legacyMessageState(message: LegacyMessage): MessageContentState {
  if (message.status === "pending") return "pending"
  if (message.status === "streaming") return "streaming"
  if (message.status === "error")
    return message.text.trim() || (message.artifactIds?.length ?? 0) > 0
      ? "incomplete"
      : "failed"
  return "complete"
}

function messageContent(
  message: LegacyMessage,
  ids: LegacyIdMap
): ConversationMessage["content"] {
  const parts: ConversationMessage["content"]["parts"][number][] = []
  if (message.text.length > 0) parts.push({ type: "text", text: message.text })
  for (const legacyArtifactId of message.artifactIds ?? [])
    parts.push({
      type: "artifact-reference",
      artifactId: ids.artifact(legacyArtifactId),
    })
  return { schemaVersion: 1, parts }
}

interface LegacyTurnGroup {
  readonly key: string
  readonly firstIndex: number
  readonly users: LegacyMessage[]
  readonly assistants: LegacyMessage[]
}

function groupLegacyTurns(thread: LegacyThread): readonly LegacyTurnGroup[] {
  const groups = new Map<string, LegacyTurnGroup>()
  const userGroupById = new Map<string, LegacyTurnGroup>()

  thread.messages.forEach((message, index) => {
    if (message.role !== "user") return
    const key = message.parentMessageId ?? "root"
    const existing = groups.get(key)
    const group =
      existing ??
      ({
        key,
        firstIndex: index,
        users: [],
        assistants: [],
      } satisfies LegacyTurnGroup)
    group.users.push(message)
    groups.set(key, group)
    userGroupById.set(message.id, group)
  })

  thread.messages.forEach((message) => {
    if (message.role !== "assistant") return
    const group =
      message.parentMessageId === null
        ? undefined
        : userGroupById.get(message.parentMessageId)
    if (!group)
      throw new LegacyThreadTreeProjectionError(
        `Thread ${thread.id} 的 assistant ${message.id} 没有同 Thread user 父节点`
      )
    group.assistants.push(message)
  })

  return [...groups.values()].sort((left, right) =>
    left.firstIndex === right.firstIndex
      ? left.key.localeCompare(right.key)
      : left.firstIndex - right.firstIndex
  )
}

function activePair(
  thread: LegacyThread,
  group: LegacyTurnGroup
): { readonly user: LegacyMessage; readonly assistant: LegacyMessage } {
  const activeIds = new Set(
    activeMessagePath(thread).map((message) => message.id)
  )
  const assistant =
    group.assistants.find((message) => activeIds.has(message.id)) ??
    group.assistants.at(-1)
  if (!assistant || assistant.parentMessageId === null)
    throw new LegacyThreadTreeProjectionError(
      `Thread ${thread.id} 的 Turn ${group.key} 没有 assistant 变体`
    )
  const user = group.users.find(
    (message) => message.id === assistant.parentMessageId
  )
  if (!user)
    throw new LegacyThreadTreeProjectionError(
      `Thread ${thread.id} 的 assistant ${assistant.id} 缺少 user 变体`
    )
  return { user, assistant }
}

function projectThreadEntities(input: {
  readonly state: ThreadTreeState
  readonly conversationId: ConversationId
  readonly ids: LegacyIdMap
}): {
  readonly threads: Record<string, ConversationThread>
  readonly turns: Record<string, ConversationTurn>
  readonly messages: Record<string, ConversationMessage>
} {
  const threads: Record<string, ConversationThread> = {}
  const turns: Record<string, ConversationTurn> = {}
  const messages: Record<string, ConversationMessage> = {}

  for (const legacyThread of Object.values(input.state.threads)) {
    const canonicalThreadId = input.ids.thread(legacyThread.id)
    threads[canonicalThreadId] = {
      id: canonicalThreadId,
      conversationId: input.conversationId,
      modelId: legacyThread.modelId,
      localTitle: legacyThread.id === "main" ? null : legacyThread.title,
      revision: 0,
      lifecycle: "active",
    }

    const groups = groupLegacyTurns(legacyThread)
    groups.forEach((group, position) => {
      const canonicalTurnId = input.ids.turn(legacyThread.id, group.key)
      const pair = activePair(legacyThread, group)
      turns[canonicalTurnId] = {
        id: canonicalTurnId,
        threadId: canonicalThreadId,
        position,
        activeUserMessageId: input.ids.message(pair.user.id),
        activeAssistantMessageId: input.ids.message(pair.assistant.id),
        revision: 0,
      }

      const firstUserId = group.users[0]?.id
      const firstAssistantId = group.assistants[0]?.id
      for (const legacyMessage of [...group.users, ...group.assistants]) {
        const canonicalMessageId = input.ids.message(legacyMessage.id)
        const variantSource =
          legacyMessage.role === "user"
            ? firstUserId && firstUserId !== legacyMessage.id
              ? input.ids.message(firstUserId)
              : undefined
            : firstAssistantId && firstAssistantId !== legacyMessage.id
              ? input.ids.message(firstAssistantId)
              : undefined
        messages[canonicalMessageId] = {
          id: canonicalMessageId,
          threadId: canonicalThreadId,
          turnId: canonicalTurnId,
          role: legacyMessage.role,
          content: messageContent(legacyMessage, input.ids),
          contentState: legacyMessageState(legacyMessage),
          ...(variantSource ? { variantOfMessageId: variantSource } : {}),
          createdAt: LEGACY_PROJECTION_UNKNOWN_TIMESTAMP,
        }
      }
    })
  }

  return { threads, turns, messages }
}

function projectForks(input: {
  readonly state: ThreadTreeState
  readonly conversationId: ConversationId
  readonly actorId: string
  readonly ids: LegacyIdMap
}): Record<string, ThreadFork> {
  const forks: Record<string, ThreadFork> = {}
  for (const legacyChild of Object.values(input.state.threads)) {
    if (legacyChild.id === "main") continue
    if (!legacyChild.parentId || !legacyChild.forkFromMsgId)
      throw new LegacyThreadTreeProjectionError(
        `非根 Thread ${legacyChild.id} 缺少遗留 Fork 来源`
      )
    const parent = input.state.threads[legacyChild.parentId]
    const source = parent?.messages.find(
      (message) => message.id === legacyChild.forkFromMsgId
    )
    if (!source)
      throw new LegacyThreadTreeProjectionError(
        `Thread ${legacyChild.id} 的来源 Message 不存在`
      )
    const legacyFork = source.forks.find(
      (fork) => fork.threadId === legacyChild.id
    )
    const id = input.ids.fork(legacyChild.id)
    forks[id] = {
      id,
      conversationId: input.conversationId,
      parentThreadId: input.ids.thread(parent.id),
      sourceMessageId: input.ids.message(source.id),
      childThreadId: input.ids.thread(legacyChild.id),
      ...(legacyFork?.anchor
        ? { anchor: structuredClone(legacyFork.anchor) }
        : {}),
      createdBy: input.actorId,
      createdAt: LEGACY_PROJECTION_UNKNOWN_TIMESTAMP,
    }
  }
  return forks
}

function projectArtifact(
  legacy: LegacyArtifact,
  ids: LegacyIdMap
): ConversationArtifactProvenance {
  return {
    id: ids.artifact(legacy.id),
    sourceThreadId: ids.thread(legacy.sourceThreadId),
    sourceMessageId: ids.message(legacy.sourceMessageId),
    title: legacy.title,
    kind: legacy.kind,
  }
}

export function projectLegacyThreadTree(
  rawInput: ProjectLegacyThreadTreeInput
): ConversationSnapshot {
  const state = parseThreadTreeState(rawInput.state)
  const ids = createLegacyIdMap(rawInput)
  const entities = projectThreadEntities({
    state,
    conversationId: rawInput.conversationId,
    ids,
  })
  const artifactProvenance = Object.fromEntries(
    Object.values(state.artifacts).map((artifact) => {
      const projected = projectArtifact(artifact, ids)
      return [projected.id, projected]
    })
  )
  const snapshot: ConversationSnapshot = {
    schemaVersion: CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
    project: {
      id: rawInput.projectId,
      workspaceId: rawInput.workspaceId,
      title: rawInput.projectTitle,
      revision: 0,
      lifecycle: "active",
    },
    conversation: {
      id: rawInput.conversationId,
      projectId: rawInput.projectId,
      rootThreadId: ids.thread("main"),
      autoTitle: rawInput.conversationAutoTitle,
      customTitle: rawInput.conversationCustomTitle,
      revision: 0,
      lifecycle: "active",
    },
    ...entities,
    threadForks: projectForks({
      state,
      conversationId: rawInput.conversationId,
      actorId: rawInput.actorId,
      ids,
    }),
    generations: {},
    artifactProvenance,
  }
  assertValidConversationSnapshot(snapshot)
  return snapshot
}
