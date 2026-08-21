import type {
  CanonicalEntityDelta,
  CommandSuccess,
  ConversationSnapshotResult,
} from "../application/conversation-command-contracts"
import type { CanonicalGenerationRecord } from "../application/conversation-generation-service"
import { checkpointMessageContent } from "../domain/conversation-generation"
import type {
  Conversation,
  ConversationArtifactProvenance,
  ConversationGeneration,
  ConversationId,
  ConversationMessage,
  ConversationSnapshot,
  ConversationThread,
  ConversationTurn,
  GenerationId,
  MessageId,
  Project,
  ThreadFork,
  ThreadId,
} from "../domain/conversation-model"
import { assertValidConversationSnapshot } from "../domain/conversation-validation"
import { parseConversationSnapshotResult } from "./conversation-client-contracts"

export type ClientGeneration =
  ConversationGeneration | CanonicalGenerationRecord

export interface CanonicalClientState {
  readonly schemaVersion: 1
  readonly project: Project | null
  readonly conversationsById: Readonly<Record<string, Conversation>>
  readonly threadsById: Readonly<Record<string, ConversationThread>>
  readonly threadForksById: Readonly<Record<string, ThreadFork>>
  readonly turnsById: Readonly<Record<string, ConversationTurn>>
  readonly messagesById: Readonly<Record<string, ConversationMessage>>
  readonly generationsById: Readonly<Record<string, ClientGeneration>>
  readonly artifactProvenanceById: Readonly<
    Record<string, ConversationArtifactProvenance>
  >
  /** 命令并发边界的最新服务端 revision；不能从实体字段顺序推断。 */
  readonly revisionsByScopeId: Readonly<Record<string, number>>
  readonly checkpointVersionsByGenerationId: Readonly<Record<string, number>>
  readonly tombstoneRevisionsByEntityId: Readonly<Record<string, number>>
  readonly staleConversationIds: ReadonlySet<ConversationId>
  readonly loadingError: Error | null
  readonly commitVersion: number
}

export type PendingCommandStatus = "pending" | "confirming" | "failed"

export interface PendingCommandOverlay {
  readonly commandId: string
  readonly kind: string
  readonly threadId?: ThreadId
  readonly presentationKey: string
  readonly draft?: string
  readonly status: PendingCommandStatus
  readonly error?: string
}

export interface CommandOverlayState {
  readonly pendingByCommandId: Readonly<Record<string, PendingCommandOverlay>>
}

export interface DeltaMergeResult {
  readonly applied: boolean
  readonly requiresReload: boolean
  readonly reason?: string
}

export type CanonicalSubscriptionKey =
  | "canonical"
  | `conversation:${string}`
  | `thread:${string}`
  | `thread:${string}:messages`
  | `message:${string}`
  | `generation:${string}`
  | `command:${string}`

export interface NormalizedConversationStore {
  readonly getState: () => CanonicalClientState
  readonly getCommandState: () => CommandOverlayState
  readonly installSnapshot: (value: unknown) => ConversationSnapshotResult
  readonly mergeCommandResult: (result: CommandSuccess) => DeltaMergeResult
  readonly mergeGeneration: (
    generation: CanonicalGenerationRecord
  ) => DeltaMergeResult
  readonly markConversationStale: (
    conversationId: ConversationId,
    reason: string
  ) => void
  readonly revisionOf: (scopeId: string) => number | undefined
  readonly subscribe: (
    key: CanonicalSubscriptionKey,
    fn: () => void
  ) => () => void
  readonly snapshotForKey: (key: CanonicalSubscriptionKey) => number
  readonly beginCommand: (overlay: PendingCommandOverlay) => void
  readonly markCommandConfirming: (commandId: string) => void
  readonly resolveCommand: (commandId: string) => void
  readonly failCommand: (commandId: string, message: string) => void
}

const EMPTY_STATE: CanonicalClientState = {
  schemaVersion: 1,
  project: null,
  conversationsById: {},
  threadsById: {},
  threadForksById: {},
  turnsById: {},
  messagesById: {},
  generationsById: {},
  artifactProvenanceById: {},
  revisionsByScopeId: {},
  checkpointVersionsByGenerationId: {},
  tombstoneRevisionsByEntityId: {},
  staleConversationIds: new Set(),
  loadingError: null,
  commitVersion: 0,
}

function deepFreeze<T>(value: T): T {
  if (
    process.env.NODE_ENV === "production" ||
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  )
    return value
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>))
    deepFreeze(nested)
  return value
}

function cloneRegistry<T>(
  value: Readonly<Record<string, T>>
): Record<string, T> {
  return { ...value }
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function fullGeneration(
  generation: ClientGeneration
): generation is CanonicalGenerationRecord {
  return "checkpointVersion" in generation
}

function snapshotFromState(
  state: CanonicalClientState,
  targetConversation: Conversation
): ConversationSnapshot {
  if (!state.project) throw new Error("规范 Store 缺少 Project")
  return {
    schemaVersion: 1,
    project: state.project,
    conversation: targetConversation,
    threads: state.threadsById,
    threadForks: state.threadForksById,
    turns: state.turnsById,
    messages: state.messagesById,
    generations: state.generationsById,
    artifactProvenance: state.artifactProvenanceById,
  }
}

function entityRevision(entity: unknown): number | undefined {
  if (!entity || typeof entity !== "object" || !("revision" in entity))
    return undefined
  const value = (entity as { revision?: unknown }).revision
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function touchedKeysForDelta(
  delta: CanonicalEntityDelta
): Set<CanonicalSubscriptionKey> {
  const keys = new Set<CanonicalSubscriptionKey>(["canonical"])
  for (const conversation of delta.upsert.conversations ?? [])
    keys.add(`conversation:${conversation.id}`)
  for (const thread of delta.upsert.threads ?? [])
    keys.add(`thread:${thread.id}`)
  for (const message of delta.upsert.messages ?? []) {
    keys.add(`message:${message.id}`)
    keys.add(`thread:${message.threadId}:messages`)
  }
  for (const generation of delta.upsert.generations ?? []) {
    keys.add(`generation:${generation.id}`)
    keys.add(`thread:${generation.threadId}:messages`)
  }
  for (const fork of delta.upsert.threadForks ?? []) {
    keys.add(`thread:${fork.parentThreadId}`)
    keys.add(`thread:${fork.childThreadId}`)
  }
  for (const id of delta.remove.conversations ?? [])
    keys.add(`conversation:${id}`)
  for (const id of delta.remove.threads ?? []) keys.add(`thread:${id}`)
  for (const id of delta.remove.messages ?? []) keys.add(`message:${id}`)
  for (const id of delta.remove.generations ?? []) keys.add(`generation:${id}`)
  return keys
}

export function createNormalizedConversationStore(): NormalizedConversationStore {
  let state = deepFreeze(EMPTY_STATE)
  let commands: CommandOverlayState = deepFreeze({ pendingByCommandId: {} })
  const listeners = new Map<CanonicalSubscriptionKey, Set<() => void>>()
  const keyVersions = new Map<CanonicalSubscriptionKey, number>()

  const notify = (keys: Iterable<CanonicalSubscriptionKey>) => {
    for (const key of keys) {
      keyVersions.set(key, (keyVersions.get(key) ?? 0) + 1)
      for (const listener of listeners.get(key) ?? []) listener()
    }
  }

  const commitState = (
    next: Omit<CanonicalClientState, "commitVersion">,
    keys: Iterable<CanonicalSubscriptionKey>
  ) => {
    state = deepFreeze({ ...next, commitVersion: state.commitVersion + 1 })
    notify(keys)
  }

  const markStale = (targetId: ConversationId, reason: string) => {
    const stale = new Set(state.staleConversationIds)
    stale.add(targetId)
    commitState(
      {
        ...state,
        staleConversationIds: stale,
        loadingError: new Error(reason),
      },
      ["canonical", `conversation:${targetId}`]
    )
  }

  return {
    getState: () => state,
    getCommandState: () => commands,
    installSnapshot(value) {
      // 所有解析、归属和引用验证在 commit 之前完成；失败不会触碰旧状态。
      const parsed = parseConversationSnapshotResult(value)
      const { snapshot } = parsed
      const generationsById: Record<string, ClientGeneration> = {
        ...snapshot.generations,
      }
      const checkpointVersions: Record<string, number> = {}
      for (const generation of parsed.generations) {
        generationsById[generation.id] = generation
        checkpointVersions[generation.id] = generation.checkpointVersion
      }
      const revisions: Record<string, number> = {
        [snapshot.project.id]: snapshot.project.revision,
        [snapshot.conversation.id]: snapshot.conversation.revision,
      }
      for (const entity of [
        ...Object.values(snapshot.threads),
        ...Object.values(snapshot.turns),
      ])
        revisions[entity.id] = entity.revision
      commitState(
        {
          schemaVersion: 1,
          project: deepFreeze(structuredClone(snapshot.project)),
          conversationsById: deepFreeze({
            [snapshot.conversation.id]: structuredClone(snapshot.conversation),
          }),
          threadsById: deepFreeze(structuredClone(snapshot.threads)),
          threadForksById: deepFreeze(structuredClone(snapshot.threadForks)),
          turnsById: deepFreeze(structuredClone(snapshot.turns)),
          messagesById: deepFreeze(structuredClone(snapshot.messages)),
          generationsById: deepFreeze(structuredClone(generationsById)),
          artifactProvenanceById: deepFreeze(
            structuredClone(snapshot.artifactProvenance)
          ),
          revisionsByScopeId: deepFreeze(revisions),
          checkpointVersionsByGenerationId: deepFreeze(checkpointVersions),
          tombstoneRevisionsByEntityId: {},
          staleConversationIds: new Set(),
          loadingError: null,
        },
        ["canonical", `conversation:${snapshot.conversation.id}`]
      )
      return parsed
    },
    mergeCommandResult(result) {
      const conversation = Object.values(state.conversationsById)[0]
      if (!conversation)
        return {
          applied: false,
          requiresReload: true,
          reason: "Store 尚未 boot",
        }
      if (result.schemaVersion !== 1) {
        markStale(conversation.id, "收到未知 command delta schemaVersion")
        return {
          applied: false,
          requiresReload: true,
          reason: "unknown_schema",
        }
      }

      for (const [scopeId, incoming] of Object.entries(result.revisions)) {
        const current = state.revisionsByScopeId[scopeId]
        if (current !== undefined && incoming > current + 1) {
          markStale(conversation.id, `scope ${scopeId} 出现 revision 间隙`)
          return {
            applied: false,
            requiresReload: true,
            reason: "revision_gap",
          }
        }
      }
      for (const ids of Object.values(result.delta.remove)) {
        for (const removedId of ids ?? []) {
          if (result.revisions[removedId] === undefined) {
            markStale(
              conversation.id,
              `删除 ${removedId} 缺少 tombstone revision`
            )
            return {
              applied: false,
              requiresReload: true,
              reason: "missing_tombstone_revision",
            }
          }
        }
      }

      const conversations = cloneRegistry(state.conversationsById)
      const threads = cloneRegistry(state.threadsById)
      const forks = cloneRegistry(state.threadForksById)
      const turns = cloneRegistry(state.turnsById)
      const messages = cloneRegistry(state.messagesById)
      const generations = cloneRegistry(state.generationsById)
      const revisions = cloneRegistry(state.revisionsByScopeId)
      const tombstones = cloneRegistry(state.tombstoneRevisionsByEntityId)
      let changed = false

      const upsertVersioned = <T extends { readonly id: string }>(
        registry: Record<string, T>,
        values: readonly T[]
      ) => {
        for (const value of values) {
          const currentVersion = revisions[value.id]
          const incomingVersion =
            entityRevision(value) ?? result.revisions[value.id]
          if (
            incomingVersion !== undefined &&
            currentVersion !== undefined &&
            incomingVersion < currentVersion
          )
            continue
          if (stableEqual(registry[value.id], value)) continue
          registry[value.id] = deepFreeze(structuredClone(value))
          if (incomingVersion !== undefined)
            revisions[value.id] = incomingVersion
          changed = true
        }
      }
      const upsertImmutable = <T extends { readonly id: string }>(
        registry: Record<string, T>,
        values: readonly T[]
      ): boolean => {
        for (const value of values) {
          const current = registry[value.id]
          if (current && !stableEqual(current, value)) return false
          if (!current) {
            registry[value.id] = deepFreeze(structuredClone(value))
            changed = true
          }
        }
        return true
      }

      upsertVersioned(conversations, result.delta.upsert.conversations ?? [])
      upsertVersioned(threads, result.delta.upsert.threads ?? [])
      upsertVersioned(turns, result.delta.upsert.turns ?? [])
      if (
        !upsertImmutable(forks, result.delta.upsert.threadForks ?? []) ||
        !upsertImmutable(messages, result.delta.upsert.messages ?? [])
      ) {
        markStale(conversation.id, "不可变实体收到冲突内容")
        return {
          applied: false,
          requiresReload: true,
          reason: "identity_conflict",
        }
      }
      upsertImmutable(generations, result.delta.upsert.generations ?? [])

      for (const [scopeId, incoming] of Object.entries(result.revisions)) {
        if ((revisions[scopeId] ?? -1) < incoming) {
          revisions[scopeId] = incoming
          changed = true
        }
      }

      const remove = <T>(
        registry: Record<string, T>,
        ids: readonly string[]
      ) => {
        for (const id of ids) {
          const incoming = result.revisions[id]!
          if ((tombstones[id] ?? -1) >= incoming) continue
          delete registry[id]
          tombstones[id] = incoming
          revisions[id] = incoming
          changed = true
        }
      }
      remove(conversations, result.delta.remove.conversations ?? [])
      remove(threads, result.delta.remove.threads ?? [])
      remove(turns, result.delta.remove.turns ?? [])
      remove(messages, result.delta.remove.messages ?? [])
      remove(generations, result.delta.remove.generations ?? [])

      if (!changed) return { applied: false, requiresReload: false }
      const next: Omit<CanonicalClientState, "commitVersion"> = {
        ...state,
        conversationsById: conversations,
        threadsById: threads,
        threadForksById: forks,
        turnsById: turns,
        messagesById: messages,
        generationsById: generations,
        revisionsByScopeId: revisions,
        tombstoneRevisionsByEntityId: tombstones,
        loadingError: null,
      }
      const remainingConversation = conversations[conversation.id]
      if (remainingConversation)
        assertValidConversationSnapshot(
          snapshotFromState(
            { ...next, commitVersion: state.commitVersion },
            remainingConversation
          )
        )
      commitState(next, touchedKeysForDelta(result.delta))
      return { applied: true, requiresReload: false }
    },
    mergeGeneration(generation) {
      const conversation = state.conversationsById[generation.conversationId]
      if (!conversation)
        return { applied: false, requiresReload: true, reason: "not_loaded" }
      const currentVersion =
        state.checkpointVersionsByGenerationId[generation.id] ?? -1
      if (generation.checkpointVersion <= currentVersion)
        return { applied: false, requiresReload: false }
      const output = state.messagesById[generation.outputMessageId]
      if (!output || output.threadId !== generation.threadId) {
        markStale(conversation.id, "Generation 输出 Message 不可解析")
        return {
          applied: false,
          requiresReload: true,
          reason: "message_missing",
        }
      }
      const generations = cloneRegistry(state.generationsById)
      generations[generation.id] = deepFreeze(structuredClone(generation))
      const messages = cloneRegistry(state.messagesById)
      messages[output.id] = deepFreeze({
        ...output,
        content: checkpointMessageContent(generation.checkpoint),
        contentState: generation.contentState,
      })
      const versions = cloneRegistry(state.checkpointVersionsByGenerationId)
      versions[generation.id] = generation.checkpointVersion
      commitState(
        {
          ...state,
          generationsById: generations,
          messagesById: messages,
          checkpointVersionsByGenerationId: versions,
          loadingError: null,
        },
        [
          "canonical",
          `generation:${generation.id}`,
          `message:${output.id}`,
          `thread:${output.threadId}:messages`,
        ]
      )
      return { applied: true, requiresReload: false }
    },
    markConversationStale: markStale,
    revisionOf: (scopeId) => state.revisionsByScopeId[scopeId],
    subscribe(key, fn) {
      const values = listeners.get(key) ?? new Set()
      values.add(fn)
      listeners.set(key, values)
      return () => {
        values.delete(fn)
        if (values.size === 0) listeners.delete(key)
      }
    },
    snapshotForKey: (key) => keyVersions.get(key) ?? 0,
    beginCommand(overlay) {
      commands = deepFreeze({
        pendingByCommandId: {
          ...commands.pendingByCommandId,
          [overlay.commandId]: deepFreeze(structuredClone(overlay)),
        },
      })
      notify([`command:${overlay.commandId}`])
    },
    markCommandConfirming(commandId) {
      const current = commands.pendingByCommandId[commandId]
      if (!current) return
      commands = deepFreeze({
        pendingByCommandId: {
          ...commands.pendingByCommandId,
          [commandId]: { ...current, status: "confirming" },
        },
      })
      notify([`command:${commandId}`])
    },
    resolveCommand(commandId) {
      if (!commands.pendingByCommandId[commandId]) return
      const pending = { ...commands.pendingByCommandId }
      delete pending[commandId]
      commands = deepFreeze({ pendingByCommandId: pending })
      notify([`command:${commandId}`])
    },
    failCommand(commandId, message) {
      const current = commands.pendingByCommandId[commandId]
      if (!current) return
      commands = deepFreeze({
        pendingByCommandId: {
          ...commands.pendingByCommandId,
          [commandId]: { ...current, status: "failed", error: message },
        },
      })
      notify([`command:${commandId}`])
    },
  }
}

export function canonicalGenerationRecord(
  generation: ClientGeneration | undefined
): CanonicalGenerationRecord | null {
  return generation && fullGeneration(generation) ? generation : null
}

export const canonicalEntityKey = {
  conversation: (id: ConversationId) => `conversation:${id}` as const,
  thread: (id: ThreadId) => `thread:${id}` as const,
  threadMessages: (id: ThreadId) => `thread:${id}:messages` as const,
  message: (id: MessageId) => `message:${id}` as const,
  generation: (id: GenerationId) => `generation:${id}` as const,
}
