import type { TextAnchor } from "./text-anchor.ts"
import { CONVERSATION_SNAPSHOT_SCHEMA_VERSION } from "../../../constants/conversation-domain.ts"

declare const entityIdBrand: unique symbol

export type EntityId<Kind extends string> = string & {
  readonly [entityIdBrand]: Kind
}

export type WorkspaceId = EntityId<"Workspace">
export type ProjectId = EntityId<"Project">
export type ConversationId = EntityId<"Conversation">
export type ThreadId = EntityId<"Thread">
export type ThreadForkId = EntityId<"ThreadFork">
export type TurnId = EntityId<"Turn">
export type MessageId = EntityId<"Message">
export type GenerationId = EntityId<"Generation">
export type ProjectFileId = EntityId<"ProjectFile">
export type MemoryItemId = EntityId<"MemoryItem">
export type ProjectInstructionVersionId = EntityId<"ProjectInstructionVersion">
export type ArtifactId = EntityId<"Artifact">

function opaqueId<Kind extends string>(
  kind: Kind,
  value: string
): EntityId<Kind> {
  const normalized = value.trim()
  if (normalized.length === 0)
    throw new InvalidEntityIdError(kind, "ID 不能为空")
  if (/\p{C}/u.test(normalized))
    throw new InvalidEntityIdError(kind, "ID 不能包含控制字符")
  return normalized as EntityId<Kind>
}

export class InvalidEntityIdError extends Error {
  readonly kind: string

  constructor(kind: string, message: string) {
    super(`${kind}: ${message}`)
    this.name = "InvalidEntityIdError"
    this.kind = kind
  }
}

export const workspaceId = (value: string): WorkspaceId =>
  opaqueId("Workspace", value)
export const projectId = (value: string): ProjectId =>
  opaqueId("Project", value)
export const conversationId = (value: string): ConversationId =>
  opaqueId("Conversation", value)
export const threadId = (value: string): ThreadId => {
  if (value.trim() === "main")
    throw new InvalidEntityIdError(
      "Thread",
      '"main" 是遗留角色键，不能作为规范 ID'
    )
  return opaqueId("Thread", value)
}
export const threadForkId = (value: string): ThreadForkId =>
  opaqueId("ThreadFork", value)
export const turnId = (value: string): TurnId => opaqueId("Turn", value)
export const messageId = (value: string): MessageId =>
  opaqueId("Message", value)
export const generationId = (value: string): GenerationId =>
  opaqueId("Generation", value)
export const projectFileId = (value: string): ProjectFileId =>
  opaqueId("ProjectFile", value)
export const memoryItemId = (value: string): MemoryItemId =>
  opaqueId("MemoryItem", value)
export const projectInstructionVersionId = (
  value: string
): ProjectInstructionVersionId => opaqueId("ProjectInstructionVersion", value)
export const artifactId = (value: string): ArtifactId =>
  opaqueId("Artifact", value)

export type LifecycleStatus = "active" | "archived"
export type MessageRole = "user" | "assistant" | "context"
export type MessageContentState =
  "pending" | "streaming" | "complete" | "incomplete" | "failed"
export type GenerationStatus =
  | "running"
  | "stop_requested"
  | "completed"
  | "stopped"
  | "failed"
  | "superseded"
export type GenerationBillingStatus =
  "pending" | "settled" | "usage_unavailable" | "not_billable"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type MessageContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "artifact-reference"; readonly artifactId: ArtifactId }
  | {
      readonly type: "structured"
      readonly kind: string
      readonly value: JsonValue
    }

export interface MessageContent {
  readonly schemaVersion: 1
  readonly parts: readonly MessageContentPart[]
}

export interface Workspace {
  readonly id: WorkspaceId
  readonly revision: number
  readonly lifecycle: LifecycleStatus
}

export interface Project {
  readonly id: ProjectId
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly revision: number
  readonly lifecycle: LifecycleStatus
}

export interface Conversation {
  readonly id: ConversationId
  readonly projectId: ProjectId
  readonly rootThreadId: ThreadId
  readonly autoTitle: string | null
  readonly customTitle: string | null
  readonly revision: number
  readonly lifecycle: LifecycleStatus
}

export interface ConversationThread {
  readonly id: ThreadId
  readonly conversationId: ConversationId
  readonly modelId: string
  /** 仅非根 Thread 可以持久化本地列标题。 */
  readonly localTitle: string | null
  readonly revision: number
  readonly lifecycle: LifecycleStatus
}

export interface ThreadFork {
  readonly id: ThreadForkId
  readonly conversationId: ConversationId
  readonly parentThreadId: ThreadId
  readonly sourceMessageId: MessageId
  readonly childThreadId: ThreadId
  readonly anchor?: TextAnchor
  readonly createdBy: string
  readonly createdAt: string
}

export interface ConversationTurn {
  readonly id: TurnId
  readonly threadId: ThreadId
  readonly position: number
  readonly activeUserMessageId: MessageId
  readonly activeAssistantMessageId: MessageId
  readonly revision: number
}

export interface ConversationMessage {
  readonly id: MessageId
  readonly threadId: ThreadId
  readonly turnId: TurnId
  readonly role: MessageRole
  readonly content: MessageContent
  readonly contentState: MessageContentState
  readonly variantOfMessageId?: MessageId
  readonly createdAt: string
}

export type GenerationIntent =
  | { readonly kind: "send" }
  | {
      readonly kind: "regenerate-assistant"
      readonly sourceAssistantMessageId: MessageId
    }
  | {
      readonly kind: "edit-user"
      readonly sourceUserMessageId: MessageId
    }
  | { readonly kind: "retry" }

export interface ConversationGeneration {
  readonly id: GenerationId
  readonly threadId: ThreadId
  readonly turnId: TurnId
  readonly inputMessageId: MessageId
  readonly outputMessageId: MessageId
  readonly intent: GenerationIntent
  readonly status: GenerationStatus
  readonly billingStatus: GenerationBillingStatus
  readonly attempt: number
  readonly createdAt: string
}

export interface ConversationArtifactProvenance {
  readonly id: ArtifactId
  readonly sourceThreadId: ThreadId
  readonly sourceMessageId: MessageId
  readonly title: string
  readonly kind: string
  readonly lang: string | null
  readonly content: string
}

export interface ProjectInstructionVersion {
  readonly id: ProjectInstructionVersionId
  readonly projectId: ProjectId
  readonly version: number
  readonly content: string
}

export interface MemoryItem {
  readonly id: MemoryItemId
  readonly projectId: ProjectId
  readonly content: string
  readonly status: "active" | "superseded" | "archived"
  readonly revision: number
}

export interface ProjectFile {
  readonly id: ProjectFileId
  readonly projectId: ProjectId
  readonly title: string
  readonly revision: number
  readonly lifecycle: LifecycleStatus
  readonly sourceMessageId?: MessageId
  readonly sourceGenerationId?: GenerationId
}

/**
 * 规范实体的只读聚合投影。它可用于校验与首次读取，但不是整包写入载荷。
 */
export interface ConversationSnapshot {
  readonly schemaVersion: typeof CONVERSATION_SNAPSHOT_SCHEMA_VERSION
  readonly project: Project
  readonly conversation: Conversation
  readonly threads: Readonly<Record<string, ConversationThread>>
  readonly threadForks: Readonly<Record<string, ThreadFork>>
  readonly turns: Readonly<Record<string, ConversationTurn>>
  readonly messages: Readonly<Record<string, ConversationMessage>>
  readonly generations: Readonly<Record<string, ConversationGeneration>>
  readonly artifactProvenance: Readonly<
    Record<string, ConversationArtifactProvenance>
  >
}
