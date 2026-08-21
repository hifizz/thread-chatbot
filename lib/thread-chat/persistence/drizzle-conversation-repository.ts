import { and, asc, eq, sql } from "drizzle-orm"

import { db } from "../../db"
import {
  conversationArtifacts,
  conversationMessages,
  conversationThreads,
  conversationTurns,
  conversations,
  projects,
  threadForks,
  workspaceMembers,
  workspaces,
} from "../../db/schema"
import type {
  AddWorkspaceMemberInput,
  AppendMessageVariantInput,
  AppendTurnInput,
  CanonicalConversationRepository,
  CreateConversationInput,
  CreateProjectInput,
  CreateWorkspaceInput,
  ForkThreadInput,
  SelectMessageVariantInput,
} from "../application/conversation-repository"
import { ConversationRepositoryError } from "../application/conversation-repository"
import {
  conversationId,
  messageId,
  projectId,
  threadForkId,
  threadId,
  turnId,
  workspaceId,
  type ConversationMessage,
  type ConversationArtifactProvenance,
  type ConversationSnapshot,
  type ConversationThread,
  type ConversationTurn,
  type ThreadFork,
} from "../domain/conversation-model"
import {
  assertCanonicalWriteAllowed,
  resolveCanonicalPersistencePolicy,
  type CanonicalPersistencePolicy,
} from "./canonical-persistence-policy"

type ConversationTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]

interface ConversationAccess {
  readonly conversation: typeof conversations.$inferSelect
  readonly project: typeof projects.$inferSelect
}

async function findConversationAccess(
  executor: ConversationTransaction | typeof db,
  actorUserId: string,
  targetConversationId: string
): Promise<ConversationAccess | null> {
  const [row] = await executor
    .select({ conversation: conversations, project: projects })
    .from(conversations)
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, actorUserId)
      )
    )
    .where(eq(conversations.id, targetConversationId))
    .limit(1)
  return row ?? null
}

async function assertWorkspaceMember(
  transaction: ConversationTransaction,
  actorUserId: string,
  targetWorkspaceId: string,
  ownerOnly = false
): Promise<void> {
  const [membership] = await transaction
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, targetWorkspaceId),
        eq(workspaceMembers.userId, actorUserId)
      )
    )
    .limit(1)
  if (!membership || (ownerOnly && membership.role !== "owner"))
    throw new ConversationRepositoryError(
      "forbidden",
      "当前用户无权操作目标 Workspace"
    )
}

function assertConversationInput(input: CreateConversationInput): void {
  if (input.conversation.rootThreadId !== input.rootThread.id)
    throw new ConversationRepositoryError(
      "identity_conflict",
      "Conversation rootThreadId 与根 Thread ID 不一致"
    )
  if (input.rootThread.conversationId !== input.conversation.id)
    throw new ConversationRepositoryError(
      "identity_conflict",
      "根 Thread 不属于待创建 Conversation"
    )
  if (input.rootThread.localTitle?.trim())
    throw new ConversationRepositoryError(
      "identity_conflict",
      "根 Thread 不得重复保存 Conversation 标题"
    )
}

function mapThread(
  row: typeof conversationThreads.$inferSelect
): ConversationThread {
  return {
    id: threadId(row.id),
    conversationId: conversationId(row.conversationId),
    modelId: row.modelId,
    localTitle: row.localTitle,
    revision: row.revision,
    lifecycle: row.lifecycle,
  }
}

function mapTurn(row: typeof conversationTurns.$inferSelect): ConversationTurn {
  return {
    id: turnId(row.id),
    threadId: threadId(row.threadId),
    position: row.position,
    activeUserMessageId: messageId(row.activeUserMessageId),
    activeAssistantMessageId: messageId(row.activeAssistantMessageId),
    revision: row.revision,
  }
}

function mapMessage(
  row: typeof conversationMessages.$inferSelect
): ConversationMessage {
  return {
    id: messageId(row.id),
    threadId: threadId(row.threadId),
    turnId: turnId(row.turnId),
    role: row.role,
    content: row.content,
    contentState: row.contentState,
    ...(row.variantOfMessageId
      ? { variantOfMessageId: messageId(row.variantOfMessageId) }
      : {}),
    createdAt: row.createdAt.toISOString(),
  }
}

function mapFork(row: typeof threadForks.$inferSelect): ThreadFork {
  return {
    id: threadForkId(row.id),
    conversationId: conversationId(row.conversationId),
    parentThreadId: threadId(row.parentThreadId),
    sourceMessageId: messageId(row.sourceMessageId),
    childThreadId: threadId(row.childThreadId),
    ...(row.anchor ? { anchor: row.anchor as ThreadFork["anchor"] } : {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

function mapArtifact(
  row: typeof conversationArtifacts.$inferSelect
): ConversationArtifactProvenance {
  return {
    id: row.id as ConversationArtifactProvenance["id"],
    sourceThreadId: threadId(row.sourceThreadId),
    sourceMessageId: messageId(row.sourceMessageId),
    title: row.title,
    kind: row.kind,
  }
}

function registry<T extends { readonly id: string }>(
  values: readonly T[]
): Readonly<Record<string, T>> {
  return Object.fromEntries(values.map((value) => [value.id, value]))
}

export class DrizzleConversationRepository implements CanonicalConversationRepository {
  readonly policy: CanonicalPersistencePolicy

  constructor(
    policy: CanonicalPersistencePolicy = resolveCanonicalPersistencePolicy()
  ) {
    this.policy = policy
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<void> {
    assertCanonicalWriteAllowed(this.policy)
    await db.transaction(async (transaction) => {
      await transaction.insert(workspaces).values({
        id: input.workspace.id,
        revision: input.workspace.revision,
        lifecycle: input.workspace.lifecycle,
      })
      await transaction.insert(workspaceMembers).values({
        workspaceId: input.workspace.id,
        userId: input.ownerUserId,
        role: "owner",
      })
    })
  }

  async addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<void> {
    assertCanonicalWriteAllowed(this.policy)
    await db.transaction(async (transaction) => {
      await assertWorkspaceMember(
        transaction,
        input.actorUserId,
        input.workspaceId,
        true
      )
      await transaction.insert(workspaceMembers).values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
      })
    })
  }

  async createProject(input: CreateProjectInput): Promise<void> {
    assertCanonicalWriteAllowed(this.policy)
    await db.transaction(async (transaction) => {
      await assertWorkspaceMember(
        transaction,
        input.actorUserId,
        input.project.workspaceId
      )
      await transaction.insert(projects).values({
        id: input.project.id,
        workspaceId: input.project.workspaceId,
        title: input.project.title,
        revision: input.project.revision,
        lifecycle: input.project.lifecycle,
      })
    })
  }

  async createConversation(input: CreateConversationInput): Promise<void> {
    assertCanonicalWriteAllowed(this.policy)
    assertConversationInput(input)
    await db.transaction(async (transaction) => {
      const [project] = await transaction
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1)
      if (!project)
        throw new ConversationRepositoryError(
          "not_found",
          "目标 Project 不存在"
        )
      await assertWorkspaceMember(
        transaction,
        input.actorUserId,
        project.workspaceId
      )
      await transaction.insert(conversations).values({
        id: input.conversation.id,
        projectId: input.projectId,
        rootThreadId: input.conversation.rootThreadId,
        autoTitle: input.conversation.autoTitle,
        customTitle: input.conversation.customTitle,
        revision: input.conversation.revision,
        lifecycle: input.conversation.lifecycle,
      })
      await transaction.insert(conversationThreads).values({
        id: input.rootThread.id,
        conversationId: input.rootThread.conversationId,
        modelId: input.rootThread.modelId,
        localTitle: input.rootThread.localTitle,
        revision: input.rootThread.revision,
        lifecycle: input.rootThread.lifecycle,
      })
    })
  }

  async forkThread(input: ForkThreadInput): Promise<number> {
    assertCanonicalWriteAllowed(this.policy)
    if (
      input.childThread.conversationId !== input.conversationId ||
      input.fork.conversationId !== input.conversationId ||
      input.fork.childThreadId !== input.childThread.id ||
      input.fork.createdBy !== input.actorUserId
    )
      throw new ConversationRepositoryError(
        "invalid_fork",
        "待创建 Thread、ThreadFork 与 Conversation 身份不一致"
      )

    return db.transaction(async (transaction) => {
      const access = await findConversationAccess(
        transaction,
        input.actorUserId,
        input.conversationId
      )
      if (!access)
        throw new ConversationRepositoryError(
          "not_found",
          "Conversation 不存在或当前用户无权访问"
        )
      if (access.conversation.revision !== input.expectedConversationRevision)
        throw new ConversationRepositoryError(
          "version_conflict",
          "Conversation revision 已变化",
          access.conversation.revision
        )

      const [parent] = await transaction
        .select({ id: conversationThreads.id })
        .from(conversationThreads)
        .where(
          and(
            eq(conversationThreads.id, input.fork.parentThreadId),
            eq(conversationThreads.conversationId, input.conversationId)
          )
        )
        .limit(1)
      const [source] = await transaction
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, input.fork.sourceMessageId),
            eq(conversationMessages.threadId, input.fork.parentThreadId)
          )
        )
        .limit(1)
      const [existingChild] = await transaction
        .select({ id: conversationThreads.id })
        .from(conversationThreads)
        .where(eq(conversationThreads.id, input.childThread.id))
        .limit(1)
      if (!parent || !source || existingChild)
        throw new ConversationRepositoryError(
          "invalid_fork",
          "Fork 上游、来源 Message 或下游 Thread 身份无效"
        )

      await transaction.insert(conversationThreads).values({
        id: input.childThread.id,
        conversationId: input.childThread.conversationId,
        modelId: input.childThread.modelId,
        localTitle: input.childThread.localTitle,
        revision: input.childThread.revision,
        lifecycle: input.childThread.lifecycle,
      })
      await transaction.insert(threadForks).values({
        id: input.fork.id,
        conversationId: input.fork.conversationId,
        parentThreadId: input.fork.parentThreadId,
        sourceMessageId: input.fork.sourceMessageId,
        childThreadId: input.fork.childThreadId,
        anchor: input.fork.anchor,
        createdBy: input.fork.createdBy,
        createdAt: new Date(input.fork.createdAt),
      })
      const [updated] = await transaction
        .update(conversations)
        .set({
          revision: sql`${conversations.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.revision, input.expectedConversationRevision)
          )
        )
        .returning({ revision: conversations.revision })
      if (!updated)
        throw new ConversationRepositoryError(
          "version_conflict",
          "Conversation revision 已变化"
        )
      return updated.revision
    })
  }

  async appendTurn(input: AppendTurnInput): Promise<number> {
    assertCanonicalWriteAllowed(this.policy)
    if (
      input.turn.threadId !== input.userMessage.threadId ||
      input.turn.threadId !== input.assistantMessage.threadId ||
      input.turn.id !== input.userMessage.turnId ||
      input.turn.id !== input.assistantMessage.turnId ||
      input.turn.activeUserMessageId !== input.userMessage.id ||
      input.turn.activeAssistantMessageId !== input.assistantMessage.id
    )
      throw new ConversationRepositoryError(
        "invalid_turn",
        "Turn 与初始 Message 身份不一致"
      )

    return db.transaction(async (transaction) => {
      const access = await findConversationAccess(
        transaction,
        input.actorUserId,
        input.conversationId
      )
      if (!access)
        throw new ConversationRepositoryError(
          "not_found",
          "Conversation 不存在或当前用户无权访问"
        )
      const [thread] = await transaction
        .select({ revision: conversationThreads.revision })
        .from(conversationThreads)
        .where(
          and(
            eq(conversationThreads.id, input.turn.threadId),
            eq(conversationThreads.conversationId, input.conversationId)
          )
        )
        .limit(1)
      if (!thread)
        throw new ConversationRepositoryError("not_found", "Thread 不存在")
      if (thread.revision !== input.expectedThreadRevision)
        throw new ConversationRepositoryError(
          "version_conflict",
          "Thread revision 已变化",
          thread.revision
        )

      await transaction.insert(conversationTurns).values({
        id: input.turn.id,
        threadId: input.turn.threadId,
        position: input.turn.position,
        activeUserMessageId: input.turn.activeUserMessageId,
        activeAssistantMessageId: input.turn.activeAssistantMessageId,
        revision: input.turn.revision,
      })
      await transaction.insert(conversationMessages).values([
        {
          ...input.userMessage,
          createdAt: new Date(input.userMessage.createdAt),
        },
        {
          ...input.assistantMessage,
          createdAt: new Date(input.assistantMessage.createdAt),
        },
      ])
      const [updated] = await transaction
        .update(conversationThreads)
        .set({
          revision: sql`${conversationThreads.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversationThreads.id, input.turn.threadId),
            eq(conversationThreads.revision, input.expectedThreadRevision)
          )
        )
        .returning({ revision: conversationThreads.revision })
      if (!updated)
        throw new ConversationRepositoryError(
          "version_conflict",
          "Thread revision 已变化"
        )
      return updated.revision
    })
  }

  async appendMessageVariant(
    input: AppendMessageVariantInput
  ): Promise<number> {
    assertCanonicalWriteAllowed(this.policy)
    return db.transaction(async (transaction) => {
      const access = await findConversationAccess(
        transaction,
        input.actorUserId,
        input.conversationId
      )
      if (!access)
        throw new ConversationRepositoryError(
          "not_found",
          "Conversation 不存在或当前用户无权访问"
        )
      const [turn] = await transaction
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.id, input.message.turnId))
        .limit(1)
      const [source] = await transaction
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, input.sourceMessageId))
        .limit(1)
      const [thread] = turn
        ? await transaction
            .select({ conversationId: conversationThreads.conversationId })
            .from(conversationThreads)
            .where(eq(conversationThreads.id, turn.threadId))
            .limit(1)
        : []
      if (
        !turn ||
        !source ||
        thread?.conversationId !== input.conversationId ||
        turn.threadId !== input.message.threadId ||
        source.threadId !== input.message.threadId ||
        source.turnId !== input.message.turnId ||
        source.role !== input.message.role
      )
        throw new ConversationRepositoryError(
          "invalid_variant",
          "Message 变体必须与来源属于同一 Thread、Turn 和角色"
        )
      if (turn.revision !== input.expectedTurnRevision)
        throw new ConversationRepositoryError(
          "version_conflict",
          "Turn revision 已变化",
          turn.revision
        )

      await transaction.insert(conversationMessages).values({
        ...input.message,
        variantOfMessageId: input.sourceMessageId,
        createdAt: new Date(input.message.createdAt),
      })
      const activeField =
        input.message.role === "user"
          ? { activeUserMessageId: input.message.id }
          : input.message.role === "assistant"
            ? { activeAssistantMessageId: input.message.id }
            : {}
      if (input.select && input.message.role === "context")
        throw new ConversationRepositoryError(
          "invalid_variant",
          "context Message 不能成为 Turn 当前有效变体"
        )
      const [updated] = await transaction
        .update(conversationTurns)
        .set({
          ...(input.select ? activeField : {}),
          revision: sql`${conversationTurns.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversationTurns.id, turn.id),
            eq(conversationTurns.revision, input.expectedTurnRevision)
          )
        )
        .returning({ revision: conversationTurns.revision })
      if (!updated)
        throw new ConversationRepositoryError(
          "version_conflict",
          "Turn revision 已变化"
        )
      return updated.revision
    })
  }

  async selectMessageVariant(
    input: SelectMessageVariantInput
  ): Promise<number> {
    assertCanonicalWriteAllowed(this.policy)
    return db.transaction(async (transaction) => {
      const access = await findConversationAccess(
        transaction,
        input.actorUserId,
        input.conversationId
      )
      if (!access)
        throw new ConversationRepositoryError(
          "not_found",
          "Conversation 不存在或当前用户无权访问"
        )
      const [turn] = await transaction
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.id, input.turnId))
        .limit(1)
      const [message] = await transaction
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, input.messageId))
        .limit(1)
      const [thread] = turn
        ? await transaction
            .select({ conversationId: conversationThreads.conversationId })
            .from(conversationThreads)
            .where(eq(conversationThreads.id, turn.threadId))
            .limit(1)
        : []
      if (
        !turn ||
        !message ||
        thread?.conversationId !== input.conversationId ||
        message.turnId !== turn.id ||
        message.threadId !== turn.threadId ||
        message.role !== input.role ||
        (message.contentState !== "complete" &&
          message.contentState !== "incomplete")
      )
        throw new ConversationRepositoryError(
          "invalid_variant",
          "目标 Message 不是同一 Turn 中可选择的角色变体"
        )
      if (turn.revision !== input.expectedRevision)
        throw new ConversationRepositoryError(
          "version_conflict",
          "Turn revision 已变化",
          turn.revision
        )
      const [updated] = await transaction
        .update(conversationTurns)
        .set({
          ...(input.role === "user"
            ? { activeUserMessageId: input.messageId }
            : { activeAssistantMessageId: input.messageId }),
          revision: sql`${conversationTurns.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversationTurns.id, input.turnId),
            eq(conversationTurns.revision, input.expectedRevision)
          )
        )
        .returning({ revision: conversationTurns.revision })
      if (!updated)
        throw new ConversationRepositoryError(
          "version_conflict",
          "Turn revision 已变化"
        )
      return updated.revision
    })
  }

  async getConversationSnapshot(input: {
    readonly actorUserId: string
    readonly conversationId: ReturnType<typeof conversationId>
  }): Promise<ConversationSnapshot | null> {
    const access = await findConversationAccess(
      db,
      input.actorUserId,
      input.conversationId
    )
    if (!access) return null

    const [threadRows, turnRows, messageRows, forkRows, artifactRows] =
      await Promise.all([
        db
          .select()
          .from(conversationThreads)
          .where(eq(conversationThreads.conversationId, input.conversationId))
          .orderBy(
            asc(conversationThreads.createdAt),
            asc(conversationThreads.id)
          ),
        db
          .select({ turn: conversationTurns })
          .from(conversationTurns)
          .innerJoin(
            conversationThreads,
            eq(conversationThreads.id, conversationTurns.threadId)
          )
          .where(eq(conversationThreads.conversationId, input.conversationId))
          .orderBy(
            asc(conversationTurns.threadId),
            asc(conversationTurns.position),
            asc(conversationTurns.id)
          ),
        db
          .select({ message: conversationMessages })
          .from(conversationMessages)
          .innerJoin(
            conversationThreads,
            eq(conversationThreads.id, conversationMessages.threadId)
          )
          .where(eq(conversationThreads.conversationId, input.conversationId))
          .orderBy(
            asc(conversationMessages.threadId),
            asc(conversationMessages.turnId),
            asc(conversationMessages.createdAt),
            asc(conversationMessages.id)
          ),
        db
          .select()
          .from(threadForks)
          .where(eq(threadForks.conversationId, input.conversationId))
          .orderBy(asc(threadForks.createdAt), asc(threadForks.id)),
        db
          .select()
          .from(conversationArtifacts)
          .where(eq(conversationArtifacts.conversationId, input.conversationId))
          .orderBy(
            asc(conversationArtifacts.createdAt),
            asc(conversationArtifacts.id)
          ),
      ])

    const mappedThreads = threadRows.map(mapThread)
    const mappedTurns = turnRows.map(({ turn }) => mapTurn(turn))
    const mappedMessages = messageRows.map(({ message }) => mapMessage(message))
    const mappedForks = forkRows.map(mapFork)
    const mappedArtifacts = artifactRows.map(mapArtifact)

    return {
      schemaVersion: 1,
      project: {
        id: projectId(access.project.id),
        workspaceId: workspaceId(access.project.workspaceId),
        title: access.project.title,
        revision: access.project.revision,
        lifecycle: access.project.lifecycle,
      },
      conversation: {
        id: conversationId(access.conversation.id),
        projectId: projectId(access.conversation.projectId),
        rootThreadId: threadId(access.conversation.rootThreadId),
        autoTitle: access.conversation.autoTitle,
        customTitle: access.conversation.customTitle,
        revision: access.conversation.revision,
        lifecycle: access.conversation.lifecycle,
      },
      threads: registry(mappedThreads),
      threadForks: registry(mappedForks),
      turns: registry(mappedTurns),
      messages: registry(mappedMessages),
      generations: {},
      artifactProvenance: registry(mappedArtifacts),
    }
  }
}
