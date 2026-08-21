import type {
  CanonicalGenerationRecord,
  CanonicalGenerationRepository,
} from "./conversation-generation-service"
import type {
  CommandEnvelope,
  CommandSuccess,
  ConversationListItem,
  ConversationSnapshotResult,
  CreateConversationPayload,
  EditTurnInputPayload,
  ForkThreadPayload,
  OutboxEvent,
  RegenerateTurnPayload,
  RenamePayload,
  SelectTurnVariantPayload,
  SendTurnPayload,
} from "./conversation-command-contracts"
import type {
  ConversationId,
  GenerationId,
  JsonValue,
  ProjectId,
} from "../domain/conversation-model"

export interface CommandCommit<TData extends JsonValue = JsonValue> {
  readonly result: CommandSuccess<TData>
  readonly outboxEventIds: readonly string[]
}

export interface ConversationCommandUnitOfWork {
  createConversation(
    command: CommandEnvelope<CreateConversationPayload>
  ): Promise<CommandCommit>
  renameConversation(
    command: CommandEnvelope<RenamePayload>
  ): Promise<CommandCommit>
  setConversationLifecycle(
    command: CommandEnvelope<{ readonly lifecycle: "active" | "archived" }>
  ): Promise<CommandCommit>
  deleteConversation(
    command: CommandEnvelope<Record<string, never>>
  ): Promise<CommandCommit>
  renameThread(command: CommandEnvelope<RenamePayload>): Promise<CommandCommit>
  setThreadLifecycle(
    command: CommandEnvelope<{ readonly lifecycle: "active" | "archived" }>
  ): Promise<CommandCommit>
  forkThread(
    command: CommandEnvelope<ForkThreadPayload>
  ): Promise<CommandCommit>
  sendTurn(command: CommandEnvelope<SendTurnPayload>): Promise<CommandCommit>
  editTurnInput(
    command: CommandEnvelope<EditTurnInputPayload>
  ): Promise<CommandCommit>
  regenerateTurn(
    command: CommandEnvelope<RegenerateTurnPayload>
  ): Promise<CommandCommit>
  selectTurnVariant(
    command: CommandEnvelope<SelectTurnVariantPayload>
  ): Promise<CommandCommit>
}

export interface ConversationQueryPort {
  listConversations(input: {
    readonly actorUserId: string
    readonly projectId: ProjectId
    readonly includeArchived?: boolean
  }): Promise<readonly ConversationListItem[]>
  getConversationSnapshot(input: {
    readonly actorUserId: string
    readonly conversationId: ConversationId
  }): Promise<ConversationSnapshotResult | null>
}

export interface OutboxEventConsumer {
  consume(event: OutboxEvent): Promise<void>
}

export interface ConversationOutboxDispatcher {
  schedule(eventIds: readonly string[]): void
  dispatchPending(input?: {
    readonly eventIds?: readonly string[]
    readonly limit?: number
  }): Promise<number>
}

export class ConversationCommandApplicationService {
  constructor(
    private readonly commands: ConversationCommandUnitOfWork,
    private readonly queries: ConversationQueryPort,
    private readonly generations: CanonicalGenerationRepository,
    private readonly outbox: ConversationOutboxDispatcher
  ) {}

  listConversations(
    input: Parameters<ConversationQueryPort["listConversations"]>[0]
  ) {
    return this.queries.listConversations(input)
  }

  getConversationSnapshot(
    input: Parameters<ConversationQueryPort["getConversationSnapshot"]>[0]
  ) {
    return this.queries.getConversationSnapshot(input)
  }

  getGeneration(input: {
    readonly actorUserId: string
    readonly generationId: GenerationId
  }): Promise<CanonicalGenerationRecord | null> {
    return this.generations.getGeneration({
      ownerId: input.actorUserId,
      generationId: input.generationId,
    })
  }

  async stopGeneration(input: {
    readonly actorUserId: string
    readonly generationId: GenerationId
    readonly notifyLocalAbort: (generationId: GenerationId) => void
  }): Promise<CanonicalGenerationRecord | null> {
    const generation = await this.generations.requestStop({
      ownerId: input.actorUserId,
      generationId: input.generationId,
    })
    if (generation?.status === "stop_requested")
      input.notifyLocalAbort(input.generationId)
    return generation
  }

  createConversation(command: CommandEnvelope<CreateConversationPayload>) {
    return this.mutate(this.commands.createConversation(command))
  }
  renameConversation(command: CommandEnvelope<RenamePayload>) {
    return this.mutate(this.commands.renameConversation(command))
  }
  setConversationLifecycle(
    command: CommandEnvelope<{ readonly lifecycle: "active" | "archived" }>
  ) {
    return this.mutate(this.commands.setConversationLifecycle(command))
  }
  deleteConversation(command: CommandEnvelope<Record<string, never>>) {
    return this.mutate(this.commands.deleteConversation(command))
  }
  renameThread(command: CommandEnvelope<RenamePayload>) {
    return this.mutate(this.commands.renameThread(command))
  }
  setThreadLifecycle(
    command: CommandEnvelope<{ readonly lifecycle: "active" | "archived" }>
  ) {
    return this.mutate(this.commands.setThreadLifecycle(command))
  }
  forkThread(command: CommandEnvelope<ForkThreadPayload>) {
    return this.mutate(this.commands.forkThread(command))
  }
  sendTurn(command: CommandEnvelope<SendTurnPayload>) {
    return this.mutate(this.commands.sendTurn(command))
  }
  editTurnInput(command: CommandEnvelope<EditTurnInputPayload>) {
    return this.mutate(this.commands.editTurnInput(command))
  }
  regenerateTurn(command: CommandEnvelope<RegenerateTurnPayload>) {
    return this.mutate(this.commands.regenerateTurn(command))
  }
  selectTurnVariant(command: CommandEnvelope<SelectTurnVariantPayload>) {
    return this.mutate(this.commands.selectTurnVariant(command))
  }

  private async mutate<TData extends JsonValue>(
    commitPromise: Promise<CommandCommit<TData>>
  ): Promise<CommandSuccess<TData>> {
    const commit = await commitPromise
    if (!commit.result.replayed && commit.outboxEventIds.length > 0)
      this.outbox.schedule(commit.outboxEventIds)
    return commit.result
  }
}
