import type {
  ConversationGenerationCheckpoint,
  KnownGenerationUsage,
  UsageCompleteness,
} from "../domain/conversation-generation"
import type {
  ConversationGeneration,
  ConversationId,
  ConversationMessage,
  GenerationBillingStatus,
  GenerationId,
  GenerationIntent,
  GenerationStatus,
  MessageContentState,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  WorkspaceId,
} from "../domain/conversation-model"

export interface CanonicalGenerationRecord extends ConversationGeneration {
  readonly ownerId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly conversationId: ConversationId
  readonly requestHash: string
  readonly idempotencyKey: string
  readonly modelId: string
  readonly isCurrent: boolean
  readonly contentState: MessageContentState
  readonly checkpointVersion: number
  readonly checkpoint: ConversationGenerationCheckpoint
  readonly knownUsage: KnownGenerationUsage | null
  readonly usageCompleteness: UsageCompleteness
  readonly paidCallStarted: boolean
  readonly leaseOwner: string | null
  readonly leaseVersion: number
  readonly heartbeatAt: string
  readonly stopRequestedAt: string | null
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly errorCode: string | null
}

export interface StartCanonicalGenerationInput {
  readonly id: GenerationId
  readonly ownerId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly conversationId: ConversationId
  readonly threadId: ThreadId
  readonly turnId: TurnId
  readonly inputMessageId: MessageId
  readonly outputMessage: ConversationMessage & { readonly role: "assistant" }
  readonly intent: GenerationIntent
  readonly requestHash: string
  readonly idempotencyKey: string
  readonly modelId: string
  readonly expectedTurnRevision: number
  readonly leaseOwner: string
}

export type StartCanonicalGenerationResult =
  | { readonly created: true; readonly generation: CanonicalGenerationRecord }
  | { readonly created: false; readonly generation: CanonicalGenerationRecord }

export interface FinalizeCanonicalGenerationInput {
  readonly generationId: GenerationId
  readonly leaseOwner: string
  readonly expectedCheckpointVersion: number
  readonly outcome: "completed" | "stopped" | "failed"
  readonly checkpoint: ConversationGenerationCheckpoint
  readonly usageCompleteness: UsageCompleteness
  readonly knownUsage: KnownGenerationUsage | null
  readonly errorCode?: string
}

export interface CanonicalGenerationRepository {
  startGeneration(
    input: StartCanonicalGenerationInput
  ): Promise<StartCanonicalGenerationResult>
  markPaidCallStarted(input: {
    readonly generationId: GenerationId
    readonly leaseOwner: string
  }): Promise<boolean>
  getGeneration(input: {
    readonly ownerId: string
    readonly generationId: GenerationId
  }): Promise<CanonicalGenerationRecord | null>
  saveCheckpoint(input: {
    readonly generationId: GenerationId
    readonly leaseOwner: string
    readonly expectedVersion: number
    readonly checkpoint: ConversationGenerationCheckpoint
  }): Promise<
    | { readonly kind: "saved"; readonly version: number }
    | { readonly kind: "conflict"; readonly version: number }
    | { readonly kind: "terminal"; readonly version: number }
  >
  heartbeat(input: {
    readonly generationId: GenerationId
    readonly leaseOwner: string
  }): Promise<boolean>
  requestStop(input: {
    readonly ownerId: string
    readonly generationId: GenerationId
  }): Promise<CanonicalGenerationRecord | null>
  claimStale(input: {
    readonly generationId: GenerationId
    readonly staleBefore: Date
    readonly leaseOwner: string
  }): Promise<CanonicalGenerationRecord | null>
  finalizeGeneration(
    input: FinalizeCanonicalGenerationInput
  ): Promise<CanonicalGenerationRecord | null>
}

export interface CanonicalGenerationExecutor {
  execute(input: {
    readonly generation: CanonicalGenerationRecord
    readonly signal: AbortSignal
    readonly onCheckpoint: (
      checkpoint: ConversationGenerationCheckpoint
    ) => Promise<void>
  }): Promise<{
    readonly outcome: "completed" | "stopped" | "failed"
    readonly checkpoint: ConversationGenerationCheckpoint
    readonly usageCompleteness: UsageCompleteness
    readonly knownUsage: KnownGenerationUsage | null
    readonly errorCode?: string
  }>
}

export interface GenerationAbortRegistry {
  register(generationId: GenerationId, controller: AbortController): void
  abort(generationId: GenerationId): boolean
  unregister(generationId: GenerationId, controller: AbortController): void
}

export class CanonicalGenerationServiceError extends Error {
  readonly code:
    | "not_found"
    | "forbidden"
    | "version_conflict"
    | "idempotency_conflict"
    | "invalid_identity"
    | "checkpoint_conflict"

  constructor(code: CanonicalGenerationServiceError["code"], message: string) {
    super(message)
    this.name = "CanonicalGenerationServiceError"
    this.code = code
  }
}

export function expectedBillingStatus(input: {
  readonly status: GenerationStatus
  readonly paidCallStarted: boolean
  readonly usageCompleteness: UsageCompleteness
  readonly knownUsage: KnownGenerationUsage | null
}): GenerationBillingStatus {
  if (!input.paidCallStarted) return "not_billable"
  if (input.usageCompleteness === "complete" && input.knownUsage)
    return "settled"
  return "usage_unavailable"
}
