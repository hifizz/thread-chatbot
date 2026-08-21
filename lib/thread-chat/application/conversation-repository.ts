import type {
  ConversationId,
  ConversationMessage,
  ConversationSnapshot,
  ConversationThread,
  ConversationTurn,
  MessageId,
  MessageRole,
  Project,
  ProjectId,
  ThreadFork,
  ThreadId,
  TurnId,
  Workspace,
  WorkspaceId,
} from "../domain/conversation-model"

export type ConversationRepositoryErrorCode =
  | "canonical_writes_disabled"
  | "dual_write_forbidden"
  | "not_found"
  | "forbidden"
  | "identity_conflict"
  | "version_conflict"
  | "invalid_fork"
  | "invalid_turn"
  | "invalid_variant"

export class ConversationRepositoryError extends Error {
  readonly code: ConversationRepositoryErrorCode
  readonly currentRevision?: number

  constructor(
    code: ConversationRepositoryErrorCode,
    message: string,
    currentRevision?: number
  ) {
    super(message)
    this.name = "ConversationRepositoryError"
    this.code = code
    this.currentRevision = currentRevision
  }
}

export interface CreateWorkspaceInput {
  readonly workspace: Workspace
  readonly ownerUserId: string
}

export interface AddWorkspaceMemberInput {
  readonly actorUserId: string
  readonly workspaceId: WorkspaceId
  readonly userId: string
  readonly role: "owner" | "member"
}

export interface CreateProjectInput {
  readonly actorUserId: string
  readonly project: Project
}

export interface CreateConversationInput {
  readonly actorUserId: string
  readonly projectId: ProjectId
  readonly conversation: {
    readonly id: ConversationId
    readonly rootThreadId: ThreadId
    readonly autoTitle: string | null
    readonly customTitle: string | null
    readonly revision: number
    readonly lifecycle: "active" | "archived"
  }
  readonly rootThread: ConversationThread
}

export interface ForkThreadInput {
  readonly actorUserId: string
  readonly conversationId: ConversationId
  readonly expectedConversationRevision: number
  readonly childThread: ConversationThread
  readonly fork: ThreadFork
}

export interface AppendTurnInput {
  readonly actorUserId: string
  readonly conversationId: ConversationId
  readonly expectedThreadRevision: number
  readonly turn: ConversationTurn
  readonly userMessage: ConversationMessage & { readonly role: "user" }
  readonly assistantMessage: ConversationMessage & {
    readonly role: "assistant"
  }
}

export interface AppendMessageVariantInput {
  readonly actorUserId: string
  readonly conversationId: ConversationId
  readonly expectedTurnRevision: number
  readonly sourceMessageId: MessageId
  readonly message: ConversationMessage
  readonly select: boolean
}

export interface SelectMessageVariantInput {
  readonly actorUserId: string
  readonly conversationId: ConversationId
  readonly turnId: TurnId
  readonly messageId: MessageId
  readonly role: Extract<MessageRole, "user" | "assistant">
  readonly expectedRevision: number
}

/**
 * 规范 Conversation 的实体级仓储端口。
 *
 * 这里故意不暴露 saveConversationSnapshot；快照只能读取，写入必须表达具体意图。
 */
export interface CanonicalConversationRepository {
  createWorkspace(input: CreateWorkspaceInput): Promise<void>
  addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<void>
  createProject(input: CreateProjectInput): Promise<void>
  createConversation(input: CreateConversationInput): Promise<void>
  forkThread(input: ForkThreadInput): Promise<number>
  appendTurn(input: AppendTurnInput): Promise<number>
  appendMessageVariant(input: AppendMessageVariantInput): Promise<number>
  selectMessageVariant(input: SelectMessageVariantInput): Promise<number>
  getConversationSnapshot(input: {
    readonly actorUserId: string
    readonly conversationId: ConversationId
  }): Promise<ConversationSnapshot | null>
}
