/**
 * 兼容入口：Thread Chat 领域类型的唯一来源位于 lib/thread-chat/domain。
 * 客户端调用方会在后续小步迁移中逐步切换到领域入口。
 */
export * from "@/lib/thread-chat/domain/types"

import type { Message as LegacyMessage } from "@/lib/thread-chat/domain/types"

import type {
  ArtifactDTO,
  MessageDTO,
  ProjectBootstrapDTO,
  ProjectDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

/** 现有组件消费的兼容投影；uiParts 保留完整 AI SDK v7 协议。 */
export interface ConversationViewMessage extends LegacyMessage {
  uiParts?: ThreadChatUIMessage["parts"]
}

export type ConversationStreamPhase =
  "connecting" | "live" | "background" | "terminal"

export interface ConversationStreamState {
  phase: ConversationStreamPhase
  liveMessage?: ThreadChatUIMessage
  lastEventSeq: number
  pollAttempt: number
}

export interface WorkspaceCanvasSnapshot {
  pins: Record<string, { x: number; y: number }>
  viewport?: { x: number; y: number; zoom: number }
}

export interface WorkspacePanelSizes {
  columns?: number[]
  artifactDrawer?: number
}

export interface WorkspaceUiState {
  view: "columns" | "canvas"
  openThreadIds: string[]
  columnSlots: Array<{ threadId: string; folded: boolean }>
  columnWidths: Record<string, number>
  forceColumns: number | null
  placementMode: "replace" | "fold"
  selectedThreadId: string
  recents: string[]
  canvas: WorkspaceCanvasSnapshot
  panelSizes: WorkspacePanelSizes
  expandedNodes: string[]
}

export interface ConversationEntitySnapshot {
  project: ProjectDTO | null
  threadsById: Record<string, ThreadDTO>
  messagesById: Record<string, MessageDTO>
  messageIdsByThread: Record<string, string[]>
  artifactsById: Record<string, ArtifactDTO>
  artifactOrder: string[]
  streamByMessageId: Record<string, ConversationStreamState>
}

export interface OptimisticPatch {
  commandId: string
  before: ConversationEntitySnapshot
  after: ConversationEntitySnapshot
}

export interface ConversationEntityState extends ConversationEntitySnapshot {
  optimisticByCommandId: Record<string, OptimisticPatch>
}

export interface NormalizedThreadChatState extends ConversationEntityState {
  workspace: WorkspaceUiState
  hydrateProject(bootstrap: ProjectBootstrapDTO): void
  upsertProject(project: ProjectDTO): void
  upsertThread(thread: ThreadDTO): void
  upsertMessage(message: MessageDTO): void
  upsertArtifact(artifact: ArtifactDTO): void
  applyStreamSnapshot(
    messageId: string,
    message: ThreadChatUIMessage,
    throughSeq: number
  ): void
  applyStreamChunk(
    messageId: string,
    message: ThreadChatUIMessage,
    seq: number
  ): void
  markConnectingGeneration(messageId: string): void
  markBackgroundGeneration(messageId: string): void
  mergePolledMessage(message: MessageDTO): void
  reconcileTerminalMessage(message: MessageDTO): void
  beginOptimisticCommand(
    commandId: string,
    apply: (
      state: ConversationEntitySnapshot
    ) => Partial<ConversationEntitySnapshot>
  ): void
  commitOptimisticCommand(commandId: string): void
  rollbackOptimisticCommand(commandId: string): void
  removeProject(projectId: string): void
  setWorkspace(next: Partial<WorkspaceUiState>): void
}
