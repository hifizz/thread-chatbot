import { createHash } from "node:crypto"

import type {
  Conversation,
  ConversationGeneration,
  ConversationId,
  ConversationMessage,
  ConversationSnapshot,
  ConversationThread,
  ConversationTurn,
  GenerationId,
  JsonValue,
  MessageContent,
  MessageId,
  MessageRole,
  ProjectId,
  ThreadFork,
  ThreadForkId,
  ThreadId,
  TurnId,
} from "../domain/conversation-model"
import type { TextAnchor } from "../domain/text-anchor"
import type { CanonicalGenerationRecord } from "./conversation-generation-service"

export interface ConversationActor {
  readonly kind: "user"
  readonly userId: string
}

export type CommandScope =
  | { readonly type: "project"; readonly id: ProjectId }
  | { readonly type: "conversation"; readonly id: ConversationId }
  | { readonly type: "thread"; readonly id: ThreadId }
  | { readonly type: "turn"; readonly id: TurnId }
  | { readonly type: "generation"; readonly id: GenerationId }

export interface CommandEnvelope<TPayload> {
  readonly commandId: string
  readonly actor: ConversationActor
  readonly scope: CommandScope
  readonly idempotencyKey: string
  readonly expectedRevision?: number
  readonly payload: TPayload
}

export type ConversationCommandErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "version_conflict"
  | "idempotency_conflict"
  | "state_conflict"
  | "semantic_validation"
  | "fork_required"
  | "conversation_action_required"
  | "rate_limited"
  | "maintenance"
  | "internal"

export interface ConversationCommandErrorDetails {
  readonly currentRevision?: number
  readonly retryable?: boolean
  readonly field?: string
  readonly reason?: string
}

export class ConversationCommandError extends Error {
  constructor(
    readonly code: ConversationCommandErrorCode,
    message: string,
    readonly details: ConversationCommandErrorDetails = {}
  ) {
    super(message)
    this.name = "ConversationCommandError"
  }
}

export interface CanonicalEntityDelta {
  readonly upsert: {
    readonly conversations?: readonly Conversation[]
    readonly threads?: readonly ConversationThread[]
    readonly threadForks?: readonly ThreadFork[]
    readonly turns?: readonly ConversationTurn[]
    readonly messages?: readonly ConversationMessage[]
    readonly generations?: readonly ConversationGeneration[]
  }
  readonly remove: {
    readonly conversations?: readonly ConversationId[]
    readonly threads?: readonly ThreadId[]
    readonly turns?: readonly TurnId[]
    readonly messages?: readonly MessageId[]
    readonly generations?: readonly GenerationId[]
  }
  readonly invalidate: readonly string[]
}

export interface CommandSuccess<TData extends JsonValue = JsonValue> {
  readonly schemaVersion: 1
  readonly data: TData
  readonly revisions: Readonly<Record<string, number>>
  readonly delta: CanonicalEntityDelta
  readonly replayed: boolean
}

export interface ConversationListItem {
  readonly id: ConversationId
  readonly projectId: ProjectId
  readonly rootThreadId: ThreadId
  readonly title: string | null
  readonly revision: number
  readonly lifecycle: "active" | "archived"
  readonly updatedAt: string
}

export interface ConversationSnapshotResult {
  readonly snapshot: ConversationSnapshot
  readonly generations: readonly CanonicalGenerationRecord[]
  /** 可重建读取投影；key 为 Thread ID，值为继承上下文 + 本地当前消息序列。 */
  readonly contextMessageIdsByThread: Readonly<
    Record<string, readonly MessageId[]>
  >
}

export interface CreateConversationPayload {
  readonly conversationId: ConversationId
  readonly rootThreadId: ThreadId
  readonly title?: string | null
  readonly modelId: string
}

export interface RenamePayload {
  readonly title: string
}

export interface ForkThreadPayload {
  readonly conversationId: ConversationId
  readonly forkId: ThreadForkId
  readonly childThreadId: ThreadId
  readonly sourceMessageId: MessageId
  readonly modelId: string
  readonly localTitle?: string | null
  readonly anchor?: TextAnchor
}

export interface SendTurnPayload {
  readonly conversationId: ConversationId
  readonly turnId: TurnId
  readonly userMessageId: MessageId
  readonly assistantMessageId: MessageId
  readonly generationId: GenerationId
  readonly content: MessageContent
  readonly modelId: string
}

export interface EditTurnInputPayload {
  readonly conversationId: ConversationId
  readonly userMessageId: MessageId
  readonly assistantMessageId: MessageId
  readonly generationId: GenerationId
  readonly sourceUserMessageId: MessageId
  readonly content: MessageContent
  readonly modelId: string
}

export interface RegenerateTurnPayload {
  readonly conversationId: ConversationId
  readonly assistantMessageId: MessageId
  readonly generationId: GenerationId
  readonly sourceAssistantMessageId: MessageId
  readonly modelId: string
}

export interface SelectTurnVariantPayload {
  readonly conversationId: ConversationId
  readonly messageId: MessageId
  readonly role: Extract<MessageRole, "user" | "assistant">
}

export interface OutboxEvent {
  readonly id: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly aggregateRevision: number
  readonly type: string
  readonly schemaVersion: 1
  readonly actorId: string
  readonly payload: JsonValue
  readonly attempts: number
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    )
  return value
}

export function commandPayloadHash(input: {
  readonly commandType: string
  readonly expectedRevision?: number
  readonly payload: unknown
}): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(input)))
    .digest("hex")
}
