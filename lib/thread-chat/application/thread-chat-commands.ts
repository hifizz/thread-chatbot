import { invariant } from "../domain/domain-error"
import type { UserId } from "../domain/ids"
import { assertMessageForkEligible } from "../domain/message"
import type {
  ThreadChatRepositories,
  ThreadChatUnitOfWork,
} from "../infrastructure/repositories"
import type {
  CreationBundle,
  MessageCreationBundle,
  ProjectPatch,
  ReplacementBundle,
  ThreadChatApplicationDependencies,
  UserMessageInput,
} from "./application-types"

export class ThreadChatCommands {
  constructor(
    private readonly unitOfWork: ThreadChatUnitOfWork,
    private readonly dependencies: ThreadChatApplicationDependencies
  ) {}

  async createProject(input: {
    actorId: UserId
    parts: UserMessageInput
    requestedModelId?: string
  }): Promise<CreationBundle> {
    const modelId = this.dependencies.resolveModelId(input.requestedModelId)
    const result = await this.unitOfWork.transaction(async (repositories) => {
      const project = await repositories.projects.insert({
        id: this.dependencies.generateId(),
        ownerUserId: input.actorId,
      })
      const rootThread = await repositories.threads.insertRoot({
        actorId: input.actorId,
        id: this.dependencies.generateId(),
        projectId: project.id,
      })
      const created = await this.appendTurn(repositories, {
        actorId: input.actorId,
        threadId: rootThread.id,
        parts: input.parts,
        modelId,
        threadAlreadyLocked: true,
      })
      return {
        project,
        rootThread,
        artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
        ...created,
      }
    })
    await this.wakeAfterCommit(result.assistantRun.id)
    return result
  }

  async sendMessage(input: {
    actorId: UserId
    threadId: string
    parts: UserMessageInput
    requestedModelId?: string
  }): Promise<MessageCreationBundle> {
    const modelId = this.dependencies.resolveModelId(input.requestedModelId)
    const result = await this.unitOfWork.transaction((repositories) =>
      this.appendTurn(repositories, { ...input, modelId })
    )
    await this.wakeAfterCommit(result.assistantRun.id)
    return result
  }

  async forkThread(input: {
    actorId: UserId
    sourceThreadId: string
    sourceMessageId: string
    anchor?: {
      exactQuote: string
      textPosition?: { start: number; end: number }
    }
  }) {
    return this.unitOfWork.transaction(async (repositories) => {
      const parent = await repositories.threads.findOwnedByIdForUpdate(
        input.actorId,
        input.sourceThreadId
      )
      invariant(parent, "entity_not_found", "Parent Thread 不存在。")
      const source = await repositories.messages.findOwnedByIdForUpdate(
        input.actorId,
        input.sourceMessageId
      )
      invariant(source, "entity_not_found", "Fork source Message 不存在。")
      invariant(
        source.threadId === parent.id,
        "thread_source_invalid",
        "Fork source 不属于指定 Parent Thread。"
      )
      const sourceRun =
        source.role === "assistant"
          ? await repositories.messageRuns.findOwnedByAssistantMessageIdForUpdate(
              input.actorId,
              source.id
            )
          : null
      assertMessageForkEligible(source, sourceRun)
      if (input.anchor?.textPosition) {
        const sourceText = (source.parts ?? [])
          .filter(
            (part): part is Extract<typeof part, { type: "text" }> =>
              part.type === "text"
          )
          .map((part) => part.text)
          .join("\n")
        const { start, end } = input.anchor.textPosition
        invariant(
          start >= 0 &&
            end > start &&
            sourceText.slice(start, end) === input.anchor.exactQuote,
          "fork_anchor_mismatch",
          "Fork anchor 与来源 Message 的规范文本投影不一致。"
        )
      }

      const inheritedIds = parent.baseContext?.messageIds ?? []
      const current = await repositories.messages.listEffectiveOwned(
        input.actorId,
        parent.id,
        100_000
      )
      const currentAssistantIds = current
        .filter((message) => message.role === "assistant")
        .map((message) => message.id)
      const currentRuns =
        await repositories.messageRuns.findOwnedByAssistantMessageIds(
          input.actorId,
          currentAssistantIds
        )
      const completedAssistantIds = new Set(
        currentRuns
          .filter((run) => run.status === "completed")
          .map((run) => run.assistantMessageId)
      )
      const eligibleIds = current
        .filter(
          (message) =>
            message.sequence <= source.sequence &&
            message.finalizedAt !== null &&
            (message.role === "user" ||
              completedAssistantIds.has(message.id))
        )
        .map((message) => message.id)
      const baseContext = {
        schemaVersion: 1 as const,
        messageIds: [...new Set([...inheritedIds, ...eligibleIds])],
      }
      return repositories.threads.insertBranch({
        actorId: input.actorId,
        id: this.dependencies.generateId(),
        projectId: parent.projectId,
        parentThreadId: parent.id,
        sourceMessageId: source.id,
        forkSourceSnapshot: {
          schemaVersion: 1,
          ...(input.anchor === undefined
            ? {}
            : { quote: input.anchor.exactQuote }),
          sourceRole: source.role,
          sourceSequence: source.sequence,
        },
        baseContext,
      })
    })
  }

  async regenerate(input: {
    actorId: UserId
    sourceAssistantMessageId: string
    requestedModelId?: string
  }): Promise<ReplacementBundle> {
    const modelId = this.dependencies.resolveModelId(input.requestedModelId)
    const result = await this.unitOfWork.transaction(async (repositories) => {
      const found = await repositories.messages.findOwnedById(
        input.actorId,
        input.sourceAssistantMessageId
      )
      invariant(found, "entity_not_found", "Message 不存在。")
      await repositories.threads.findOwnedByIdForUpdate(
        input.actorId,
        found.threadId
      )
      const source = await repositories.messages.findOwnedByIdForUpdate(
        input.actorId,
        found.id
      )
      invariant(source, "entity_not_found", "Message 不存在。")
      invariant(
        source.role === "assistant" &&
          source.finalizedAt !== null &&
          source.supersededAt === null,
        "message_not_regeneratable",
        "Message 不满足 Regenerate 资格。"
      )
      invariant(
        await repositories.messages.isLastEffective(source),
        "fork_required",
        "历史位置需要通过 Fork 保留另一条路线。"
      )
      const run =
        await repositories.messageRuns.findOwnedByAssistantMessageIdForUpdate(
          input.actorId,
          source.id
        )
      invariant(
        run?.status === "completed",
        "message_not_regeneratable",
        "只有 completed assistant Message 可以 Regenerate。"
      )
      await repositories.messageRuns.assertNoActiveForThread(
        input.actorId,
        source.threadId
      )
      const replacement = await repositories.messages.append({
        actorId: input.actorId,
        id: this.dependencies.generateId(),
        threadId: source.threadId,
        role: "assistant",
        parts: null,
        finalizedAt: null,
        replacesMessageId: source.id,
      })
      const assistantRun = await repositories.messageRuns.insertQueued({
        actorId: input.actorId,
        id: this.dependencies.generateId(),
        assistantMessageId: replacement.id,
        modelId,
      })
      return {
        supersededMessageIds: [source.id],
        createdMessages: [replacement],
        assistantRun,
      }
    })
    await this.wakeAfterCommit(result.assistantRun.id)
    return result
  }

  async editLastUser(input: {
    actorId: UserId
    sourceUserMessageId: string
    parts: UserMessageInput
    requestedModelId?: string
  }): Promise<ReplacementBundle> {
    const modelId = this.dependencies.resolveModelId(input.requestedModelId)
    const result = await this.unitOfWork.transaction(async (repositories) => {
      const found = await repositories.messages.findOwnedById(
        input.actorId,
        input.sourceUserMessageId
      )
      invariant(found, "entity_not_found", "Message 不存在。")
      await repositories.threads.findOwnedByIdForUpdate(
        input.actorId,
        found.threadId
      )
      const source = await repositories.messages.findOwnedByIdForUpdate(
        input.actorId,
        found.id
      )
      invariant(source, "entity_not_found", "Message 不存在。")
      invariant(
        source.role === "user" &&
          source.finalizedAt !== null &&
          source.supersededAt === null,
        "message_not_editable",
        "Message 不满足 Edit 资格。"
      )
      invariant(
        await repositories.messages.isLastEffectiveUser(source),
        "fork_required",
        "只有最后一条有效 user Message 可以 Edit。"
      )
      await repositories.messageRuns.assertNoActiveForThread(
        input.actorId,
        source.threadId
      )
      const replacementUser = await repositories.messages.append({
        actorId: input.actorId,
        id: this.dependencies.generateId(),
        threadId: source.threadId,
        role: "user",
        parts: input.parts,
        finalizedAt: this.dependencies.now(),
        replacesMessageId: source.id,
      })
      const suffixIds = await repositories.messages.supersedeEffectiveRange({
        actorId: input.actorId,
        threadId: source.threadId,
        afterSequence: source.sequence,
        beforeSequence: replacementUser.sequence,
        supersededAt: this.dependencies.now(),
      })
      const replacementAssistant = await repositories.messages.append({
        actorId: input.actorId,
        id: this.dependencies.generateId(),
        threadId: source.threadId,
        role: "assistant",
        parts: null,
        finalizedAt: null,
      })
      const assistantRun = await repositories.messageRuns.insertQueued({
        actorId: input.actorId,
        id: this.dependencies.generateId(),
        assistantMessageId: replacementAssistant.id,
        modelId,
      })
      return {
        supersededMessageIds: [source.id, ...suffixIds],
        createdMessages: [replacementUser, replacementAssistant],
        assistantRun,
      }
    })
    await this.wakeAfterCommit(result.assistantRun.id)
    return result
  }

  patchProject(input: {
    actorId: UserId
    projectId: string
    patch: ProjectPatch
  }) {
    return this.unitOfWork.transaction(async (repositories) => {
      const project = await repositories.projects.updateMetadata({
        actorId: input.actorId,
        projectId: input.projectId,
        ...input.patch,
      })
      invariant(project, "entity_not_found", "Project 不存在。")
      return project
    })
  }

  setProjectArchived(input: {
    actorId: UserId
    projectId: string
    archived: boolean
  }) {
    return this.unitOfWork.transaction(async (repositories) => {
      const project = await repositories.projects.setArchived({
        ...input,
        now: this.dependencies.now(),
      })
      invariant(project, "entity_not_found", "Project 不存在。")
      return project
    })
  }

  patchBranch(input: {
    actorId: UserId
    threadId: string
    customTitle?: string | null
    archived?: boolean
  }) {
    return this.unitOfWork.transaction(async (repositories) => {
      const thread = await repositories.threads.updateBranchMetadata({
        ...input,
        now: this.dependencies.now(),
      })
      invariant(thread, "entity_not_found", "Thread 不存在。")
      return thread
    })
  }

  setFeedback(input: {
    actorId: UserId
    assistantMessageId: string
    feedback: "positive" | "negative" | null
  }) {
    return this.unitOfWork.transaction(async (repositories) => ({
      messageId: input.assistantMessageId,
      value: await repositories.feedback.set(input),
      updatedAt: this.dependencies.now(),
    }))
  }

  deleteProject(input: { actorId: UserId; projectId: string }): Promise<void> {
    return this.unitOfWork.transaction(async (repositories) => {
      const deleted = await repositories.projects.deleteOwned(
        input.actorId,
        input.projectId
      )
      invariant(deleted, "entity_not_found", "Project 不存在。")
    })
  }

  private async appendTurn(
    repositories: ThreadChatRepositories,
    input: {
      actorId: UserId
      threadId: string
      parts: UserMessageInput
      modelId: string
      threadAlreadyLocked?: boolean
    }
  ): Promise<MessageCreationBundle> {
    const thread = input.threadAlreadyLocked
      ? await repositories.threads.findOwnedById(input.actorId, input.threadId)
      : await repositories.threads.findOwnedByIdForUpdate(
          input.actorId,
          input.threadId
        )
    invariant(thread, "entity_not_found", "Thread 不存在。")
    invariant(!thread.archivedAt, "thread_archived", "已归档 Thread 不能发送消息。")
    await repositories.messageRuns.assertNoActiveForThread(
      input.actorId,
      input.threadId
    )
    const userMessage = await repositories.messages.append({
      actorId: input.actorId,
      id: this.dependencies.generateId(),
      threadId: input.threadId,
      role: "user",
      parts: input.parts,
      finalizedAt: this.dependencies.now(),
    })
    const assistantMessage = await repositories.messages.append({
      actorId: input.actorId,
      id: this.dependencies.generateId(),
      threadId: input.threadId,
      role: "assistant",
      parts: null,
      finalizedAt: null,
    })
    const assistantRun = await repositories.messageRuns.insertQueued({
      actorId: input.actorId,
      id: this.dependencies.generateId(),
      assistantMessageId: assistantMessage.id,
      modelId: input.modelId,
    })
    return { userMessage, assistantMessage, assistantRun }
  }

  private async wakeAfterCommit(messageRunId: string): Promise<void> {
    try {
      await this.dependencies.wakeRunAfterCommit?.(messageRunId)
    } catch (error) {
      this.dependencies.onWakeError?.(error)
    }
  }
}
