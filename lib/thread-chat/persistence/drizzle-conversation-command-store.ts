import { randomUUID } from "node:crypto"

import { and, asc, eq, inArray, max, sql } from "drizzle-orm"

import { CONVERSATION_COMMAND_SCHEMA_VERSION } from "../../../constants/conversation-command"
import { db } from "../../db"
import {
  conversationCommandRecords,
  conversationGenerations,
  conversationMessages,
  conversationOutboxEvents,
  conversationThreads,
  conversationTurns,
  conversations,
  projects,
  threadForks,
  workspaceMembers,
} from "../../db/schema"
import type {
  CommandCommit,
  ConversationCommandUnitOfWork,
  ConversationQueryPort,
} from "../application/conversation-command-service"
import {
  commandPayloadHash,
  ConversationCommandError,
  type CanonicalEntityDelta,
  type CommandEnvelope,
  type CommandSuccess,
  type ConversationListItem,
  type ConversationSnapshotResult,
  type CreateConversationPayload,
  type EditTurnInputPayload,
  type ForkThreadPayload,
  type RegenerateTurnPayload,
  type RenamePayload,
  type SelectTurnVariantPayload,
  type SendTurnPayload,
} from "../application/conversation-command-contracts"
import {
  emptyConversationGenerationCheckpoint,
  hasRecoverableCheckpointOutput,
  parseConversationGenerationCheckpoint,
} from "../domain/conversation-generation"
import {
  conversationId,
  generationId,
  messageId,
  projectId,
  threadForkId,
  threadId,
  turnId,
  workspaceId,
  type Conversation,
  type ConversationGeneration,
  type ConversationMessage,
  type ConversationSnapshot,
  type ConversationThread,
  type ConversationTurn,
  type GenerationIntent,
  type GenerationId,
  type JsonValue,
  type MessageId,
  type ThreadFork,
  type ThreadId,
} from "../domain/conversation-model"
import {
  assertConversationCommandApiEnabled,
  resolveConversationCommandApiPolicy,
  type ConversationCommandApiPolicy,
} from "./conversation-command-policy"

type CommandTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ACTIVE_GENERATION_STATUSES = ["running", "stop_requested"] as const

interface CommandMutation {
  readonly data: JsonValue
  readonly revisions: Readonly<Record<string, number>>
  readonly delta: CanonicalEntityDelta
  readonly events?: readonly {
    readonly id: string
    readonly aggregateType: string
    readonly aggregateId: string
    readonly aggregateRevision: number
    readonly type: string
    readonly payload: JsonValue
  }[]
}

interface ConversationAccess {
  readonly conversation: typeof conversations.$inferSelect
  readonly project: typeof projects.$inferSelect
}

interface ThreadAccess extends ConversationAccess {
  readonly thread: typeof conversationThreads.$inferSelect
}

function mapConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: conversationId(row.id),
    projectId: projectId(row.projectId),
    rootThreadId: threadId(row.rootThreadId),
    autoTitle: row.autoTitle,
    customTitle: row.customTitle,
    revision: row.revision,
    lifecycle: row.lifecycle,
  }
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

function mapGenerationSummary(
  row: typeof conversationGenerations.$inferSelect
): ConversationGeneration {
  return {
    id: generationId(row.id),
    threadId: threadId(row.threadId),
    turnId: turnId(row.turnId),
    inputMessageId: messageId(row.inputMessageId),
    outputMessageId: messageId(row.outputMessageId),
    intent: row.intent,
    status: row.status,
    billingStatus: row.billingStatus,
    attempt: row.attempt,
    createdAt: row.createdAt.toISOString(),
  }
}

function registry<T extends { readonly id: string }>(
  values: readonly T[]
): Readonly<Record<string, T>> {
  return Object.fromEntries(values.map((value) => [value.id, value]))
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}

function assertExpectedRevision(
  actual: number,
  expected: number | undefined,
  label: string
): void {
  if (expected === undefined)
    throw new ConversationCommandError(
      "invalid_request",
      `${label} 命令缺少 expectedRevision`,
      { field: "expectedRevision" }
    )
  if (actual !== expected)
    throw new ConversationCommandError(
      "version_conflict",
      `${label} revision 已变化`,
      { currentRevision: actual, retryable: true }
    )
}

function normalizedTitle(value: string): string {
  const title = value.trim()
  if (title.length === 0 || title.length > 200)
    throw new ConversationCommandError(
      "semantic_validation",
      "标题必须为 trim 后 1–200 字符",
      { field: "title" }
    )
  return title
}

async function findProjectAccess(
  transaction: CommandTransaction | typeof db,
  actorUserId: string,
  targetProjectId: string
) {
  const [row] = await transaction
    .select({ project: projects })
    .from(projects)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, actorUserId)
      )
    )
    .where(eq(projects.id, targetProjectId))
    .limit(1)
  return row?.project ?? null
}

async function findConversationAccess(
  transaction: CommandTransaction | typeof db,
  actorUserId: string,
  targetConversationId: string,
  lockForUpdate = false
): Promise<ConversationAccess | null> {
  const query = transaction
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
  const [authorized] = await query
  if (!authorized || !lockForUpdate) return authorized ?? null
  await transaction
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, targetConversationId))
    .for("update")
  const [fresh] = await query
  return fresh ?? null
}

interface ThreadAccessLocks {
  readonly conversation: "share" | "update"
  readonly thread: "share" | "update"
}

async function findThreadAccess(
  transaction: CommandTransaction | typeof db,
  actorUserId: string,
  targetThreadId: string,
  locks?: ThreadAccessLocks
): Promise<ThreadAccess | null> {
  const query = transaction
    .select({
      thread: conversationThreads,
      conversation: conversations,
      project: projects,
    })
    .from(conversationThreads)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationThreads.conversationId)
    )
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, actorUserId)
      )
    )
    .where(eq(conversationThreads.id, targetThreadId))
    .limit(1)
  const [authorized] = await query
  if (!authorized || !locks) return authorized ?? null
  await transaction
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, authorized.conversation.id))
    .for(locks.conversation)
  await transaction
    .select({ id: conversationThreads.id })
    .from(conversationThreads)
    .where(eq(conversationThreads.id, targetThreadId))
    .for(locks.thread)
  const [fresh] = await query
  return fresh ?? null
}

async function assertNoActiveGeneration(
  transaction: CommandTransaction,
  where: ReturnType<typeof eq>
): Promise<void> {
  const [active] = await transaction
    .select({ id: conversationGenerations.id })
    .from(conversationGenerations)
    .where(
      and(
        where,
        inArray(conversationGenerations.status, ACTIVE_GENERATION_STATUSES)
      )
    )
    .limit(1)
  if (active)
    throw new ConversationCommandError(
      "state_conflict",
      "存在尚未终结的 Generation",
      { reason: "generation_running" }
    )
}

export class DrizzleConversationCommandStore
  implements ConversationCommandUnitOfWork, ConversationQueryPort
{
  constructor(
    readonly policy: ConversationCommandApiPolicy = resolveConversationCommandApiPolicy(),
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID
  ) {}

  async listConversations(input: {
    readonly actorUserId: string
    readonly projectId: ReturnType<typeof projectId>
    readonly includeArchived?: boolean
  }): Promise<readonly ConversationListItem[]> {
    assertConversationCommandApiEnabled(this.policy)
    const project = await findProjectAccess(
      db,
      input.actorUserId,
      input.projectId
    )
    if (!project) return []
    const conditions = [eq(conversations.projectId, input.projectId)]
    if (!input.includeArchived)
      conditions.push(eq(conversations.lifecycle, "active"))
    const rows = await db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(asc(conversations.createdAt), asc(conversations.id))
    return rows.map((row) => ({
      id: conversationId(row.id),
      projectId: projectId(row.projectId),
      rootThreadId: threadId(row.rootThreadId),
      title: row.customTitle ?? row.autoTitle,
      revision: row.revision,
      lifecycle: row.lifecycle,
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async getConversationSnapshot(input: {
    readonly actorUserId: string
    readonly conversationId: ReturnType<typeof conversationId>
  }): Promise<ConversationSnapshotResult | null> {
    assertConversationCommandApiEnabled(this.policy)
    const access = await findConversationAccess(
      db,
      input.actorUserId,
      input.conversationId
    )
    if (!access) return null
    const [threadRows, turnRows, messageRows, forkRows, generationRows] =
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
          .from(conversationGenerations)
          .where(
            eq(conversationGenerations.conversationId, input.conversationId)
          )
          .orderBy(
            asc(conversationGenerations.createdAt),
            asc(conversationGenerations.id)
          ),
      ])
    const mappedThreads = threadRows.map(mapThread)
    const mappedTurns = turnRows.map(({ turn }) => mapTurn(turn))
    const mappedMessages = messageRows.map(({ message }) => mapMessage(message))
    const mappedForks = forkRows.map(mapFork)
    const mappedGenerations = generationRows.map(mapGenerationSummary)
    const snapshot: ConversationSnapshot = {
      schemaVersion: 1,
      project: {
        id: projectId(access.project.id),
        workspaceId: workspaceId(access.project.workspaceId),
        title: access.project.title,
        revision: access.project.revision,
        lifecycle: access.project.lifecycle,
      },
      conversation: mapConversation(access.conversation),
      threads: registry(mappedThreads),
      threadForks: registry(mappedForks),
      turns: registry(mappedTurns),
      messages: registry(mappedMessages),
      generations: registry(mappedGenerations),
      artifactProvenance: {},
    }
    return {
      snapshot,
      generations: generationRows.map((row) => ({
        ...mapGenerationSummary(row),
        ownerId: row.ownerId,
        workspaceId: workspaceId(row.workspaceId),
        projectId: projectId(row.projectId),
        conversationId: conversationId(row.conversationId),
        requestHash: row.requestHash,
        idempotencyKey: row.idempotencyKey,
        modelId: row.modelId,
        isCurrent: row.isCurrent,
        contentState: row.contentState,
        checkpointVersion: row.checkpointVersion,
        checkpoint: parseConversationGenerationCheckpoint(row.checkpoint),
        knownUsage: row.knownUsage,
        usageCompleteness: row.usageCompleteness,
        paidCallStarted: row.paidCallStarted,
        leaseOwner: row.leaseOwner,
        leaseVersion: row.leaseVersion,
        heartbeatAt: row.heartbeatAt.toISOString(),
        stopRequestedAt: row.stopRequestedAt?.toISOString() ?? null,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        errorCode: row.errorCode,
      })),
      contextMessageIdsByThread: deriveContextMessageIds({
        threads: mappedThreads,
        turns: mappedTurns,
        messages: mappedMessages,
        forks: mappedForks,
        generations: mappedGenerations,
      }),
    }
  }

  createConversation(
    command: CommandEnvelope<CreateConversationPayload>
  ): Promise<CommandCommit> {
    return this.execute("createConversation", command, async (transaction) => {
      if (command.scope.type !== "project")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Project"
        )
      const project = await findProjectAccess(
        transaction,
        command.actor.userId,
        command.scope.id
      )
      if (!project)
        throw new ConversationCommandError("not_found", "Project 不存在")
      if (project.lifecycle !== "active")
        throw new ConversationCommandError("state_conflict", "Project 已归档")
      if (
        String(command.payload.conversationId) ===
        String(command.payload.rootThreadId)
      )
        throw new ConversationCommandError(
          "semantic_validation",
          "Conversation 与根 Thread 必须使用不同稳定 ID"
        )
      const title = command.payload.title?.trim() || null
      const now = this.now()
      await transaction.insert(conversations).values({
        id: command.payload.conversationId,
        projectId: command.scope.id,
        rootThreadId: command.payload.rootThreadId,
        autoTitle: title,
        customTitle: null,
        revision: 0,
        lifecycle: "active",
        createdAt: now,
        updatedAt: now,
      })
      await transaction.insert(conversationThreads).values({
        id: command.payload.rootThreadId,
        conversationId: command.payload.conversationId,
        modelId: command.payload.modelId,
        localTitle: null,
        revision: 0,
        lifecycle: "active",
        createdAt: now,
        updatedAt: now,
      })
      const conversation = mapConversation({
        id: command.payload.conversationId,
        projectId: command.scope.id,
        rootThreadId: command.payload.rootThreadId,
        autoTitle: title,
        customTitle: null,
        revision: 0,
        lifecycle: "active",
        createdAt: now,
        updatedAt: now,
      })
      const rootThread = mapThread({
        id: command.payload.rootThreadId,
        conversationId: command.payload.conversationId,
        modelId: command.payload.modelId,
        localTitle: null,
        revision: 0,
        lifecycle: "active",
        createdAt: now,
        updatedAt: now,
      })
      return {
        data: asJson({
          conversationId: conversation.id,
          rootThreadId: rootThread.id,
        }),
        revisions: { [conversation.id]: 0, [rootThread.id]: 0 },
        delta: {
          upsert: { conversations: [conversation], threads: [rootThread] },
          remove: {},
          invalidate: [`project:${command.scope.id}:conversations`],
        },
      }
    })
  }

  renameConversation(
    command: CommandEnvelope<RenamePayload>
  ): Promise<CommandCommit> {
    return this.mutateConversation(
      "renameConversation",
      command,
      async (transaction, access) => {
        const title = normalizedTitle(command.payload.title)
        const nextRevision = access.conversation.revision + 1
        const now = this.now()
        await transaction
          .update(conversations)
          .set({ customTitle: title, revision: nextRevision, updatedAt: now })
          .where(eq(conversations.id, access.conversation.id))
        const updated = mapConversation({
          ...access.conversation,
          customTitle: title,
          revision: nextRevision,
          updatedAt: now,
        })
        return {
          data: asJson({ conversationId: updated.id }),
          revisions: { [updated.id]: nextRevision },
          delta: {
            upsert: { conversations: [updated] },
            remove: {},
            invalidate: [`project:${updated.projectId}:conversations`],
          },
        }
      }
    )
  }

  setConversationLifecycle(
    command: CommandEnvelope<{ readonly lifecycle: "active" | "archived" }>
  ): Promise<CommandCommit> {
    return this.mutateConversation(
      "setConversationLifecycle",
      command,
      async (transaction, access) => {
        if (access.conversation.lifecycle === command.payload.lifecycle)
          return conversationNoopMutation(access.conversation)
        if (command.payload.lifecycle === "archived")
          await assertNoActiveGeneration(
            transaction,
            eq(conversationGenerations.conversationId, access.conversation.id)
          )
        const nextRevision = access.conversation.revision + 1
        const now = this.now()
        await transaction
          .update(conversations)
          .set({
            lifecycle: command.payload.lifecycle,
            revision: nextRevision,
            updatedAt: now,
          })
          .where(eq(conversations.id, access.conversation.id))
        const updated = mapConversation({
          ...access.conversation,
          lifecycle: command.payload.lifecycle,
          revision: nextRevision,
          updatedAt: now,
        })
        return {
          data: asJson({
            conversationId: updated.id,
            lifecycle: updated.lifecycle,
          }),
          revisions: { [updated.id]: nextRevision },
          delta: {
            upsert: { conversations: [updated] },
            remove: {},
            invalidate: [`project:${updated.projectId}:conversations`],
          },
        }
      }
    )
  }

  deleteConversation(
    command: CommandEnvelope<Record<string, never>>
  ): Promise<CommandCommit> {
    return this.execute("deleteConversation", command, async (transaction) => {
      if (command.scope.type !== "conversation")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Conversation"
        )
      const access = await findConversationAccess(
        transaction,
        command.actor.userId,
        command.scope.id,
        true
      )
      if (!access)
        throw new ConversationCommandError("not_found", "Conversation 不存在")
      assertExpectedRevision(
        access.conversation.revision,
        command.expectedRevision,
        "Conversation"
      )
      await assertNoActiveGeneration(
        transaction,
        eq(conversationGenerations.conversationId, access.conversation.id)
      )
      await transaction
        .delete(conversationGenerations)
        .where(
          eq(conversationGenerations.conversationId, access.conversation.id)
        )
      await transaction
        .delete(conversations)
        .where(eq(conversations.id, access.conversation.id))
      return {
        data: asJson({ conversationId: access.conversation.id, deleted: true }),
        // 删除响应仍携带 tombstone revision，客户端才能拒绝迟到的旧实体 delta。
        revisions: {
          [access.conversation.id]: access.conversation.revision + 1,
        },
        delta: {
          upsert: {},
          remove: { conversations: [conversationId(access.conversation.id)] },
          invalidate: [`project:${access.project.id}:conversations`],
        },
      }
    })
  }

  renameThread(
    command: CommandEnvelope<RenamePayload>
  ): Promise<CommandCommit> {
    return this.mutateThread(
      "renameThread",
      command,
      async (transaction, access) => {
        if (access.thread.id === access.conversation.rootThreadId)
          throw new ConversationCommandError(
            "conversation_action_required",
            "根 Thread 标题由 Conversation 管理"
          )
        const title = normalizedTitle(command.payload.title)
        const nextRevision = access.thread.revision + 1
        const now = this.now()
        await transaction
          .update(conversationThreads)
          .set({ localTitle: title, revision: nextRevision, updatedAt: now })
          .where(eq(conversationThreads.id, access.thread.id))
        const updated = mapThread({
          ...access.thread,
          localTitle: title,
          revision: nextRevision,
          updatedAt: now,
        })
        return threadMutation(updated, access.conversation.id)
      }
    )
  }

  setThreadLifecycle(
    command: CommandEnvelope<{ readonly lifecycle: "active" | "archived" }>
  ): Promise<CommandCommit> {
    return this.mutateThread(
      "setThreadLifecycle",
      command,
      async (transaction, access) => {
        if (access.thread.id === access.conversation.rootThreadId)
          throw new ConversationCommandError(
            "conversation_action_required",
            "根 Thread 必须通过 Conversation 生命周期命令管理"
          )
        if (access.thread.lifecycle === command.payload.lifecycle)
          return threadMutation(
            mapThread(access.thread),
            access.conversation.id
          )
        if (command.payload.lifecycle === "archived")
          await assertNoActiveGeneration(
            transaction,
            eq(conversationGenerations.threadId, access.thread.id)
          )
        const nextRevision = access.thread.revision + 1
        const now = this.now()
        await transaction
          .update(conversationThreads)
          .set({
            lifecycle: command.payload.lifecycle,
            revision: nextRevision,
            updatedAt: now,
          })
          .where(eq(conversationThreads.id, access.thread.id))
        return threadMutation(
          mapThread({
            ...access.thread,
            lifecycle: command.payload.lifecycle,
            revision: nextRevision,
            updatedAt: now,
          }),
          access.conversation.id
        )
      }
    )
  }

  forkThread(
    command: CommandEnvelope<ForkThreadPayload>
  ): Promise<CommandCommit> {
    return this.execute("forkThread", command, async (transaction) => {
      if (command.scope.type !== "thread")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Thread"
        )
      const access = await findThreadAccess(
        transaction,
        command.actor.userId,
        command.scope.id,
        { conversation: "update", thread: "share" }
      )
      if (!access || access.conversation.id !== command.payload.conversationId)
        throw new ConversationCommandError("not_found", "Thread 不存在")
      assertExpectedRevision(
        access.conversation.revision,
        command.expectedRevision,
        "Conversation"
      )
      if (
        access.thread.lifecycle !== "active" ||
        access.conversation.lifecycle !== "active"
      )
        throw new ConversationCommandError(
          "state_conflict",
          "归档资源不能 Fork"
        )
      const [source] = await transaction
        .select({ message: conversationMessages, turn: conversationTurns })
        .from(conversationMessages)
        .innerJoin(
          conversationTurns,
          eq(conversationTurns.id, conversationMessages.turnId)
        )
        .where(
          and(
            eq(conversationMessages.id, command.payload.sourceMessageId),
            eq(conversationMessages.threadId, access.thread.id)
          )
        )
        .limit(1)
      if (
        !source ||
        (source.message.role === "user" &&
          source.turn.activeUserMessageId !== source.message.id) ||
        (source.message.role === "assistant" &&
          source.turn.activeAssistantMessageId !== source.message.id) ||
        !["complete", "incomplete"].includes(source.message.contentState)
      )
        throw new ConversationCommandError(
          "semantic_validation",
          "Fork 来源必须是上游 Thread 当前可用路径中的 Message"
        )
      const now = this.now()
      await transaction.insert(conversationThreads).values({
        id: command.payload.childThreadId,
        conversationId: access.conversation.id,
        modelId: command.payload.modelId,
        localTitle: command.payload.localTitle?.trim() || null,
        revision: 0,
        lifecycle: "active",
        createdAt: now,
        updatedAt: now,
      })
      await transaction.insert(threadForks).values({
        id: command.payload.forkId,
        conversationId: access.conversation.id,
        parentThreadId: access.thread.id,
        sourceMessageId: source.message.id,
        childThreadId: command.payload.childThreadId,
        anchor: command.payload.anchor,
        createdBy: command.actor.userId,
        createdAt: now,
      })
      const nextRevision = access.conversation.revision + 1
      await transaction
        .update(conversations)
        .set({ revision: nextRevision, updatedAt: now })
        .where(eq(conversations.id, access.conversation.id))
      const child = mapThread({
        id: command.payload.childThreadId,
        conversationId: access.conversation.id,
        modelId: command.payload.modelId,
        localTitle: command.payload.localTitle?.trim() || null,
        revision: 0,
        lifecycle: "active",
        createdAt: now,
        updatedAt: now,
      })
      const fork = mapFork({
        id: command.payload.forkId,
        conversationId: access.conversation.id,
        parentThreadId: access.thread.id,
        sourceMessageId: source.message.id,
        childThreadId: child.id,
        anchor: command.payload.anchor ?? null,
        createdBy: command.actor.userId,
        createdAt: now,
      })
      const eventId = this.id()
      return {
        data: asJson({ childThreadId: child.id, forkId: fork.id }),
        revisions: { [access.conversation.id]: nextRevision, [child.id]: 0 },
        delta: {
          upsert: { threads: [child], threadForks: [fork] },
          remove: {},
          invalidate: [
            `conversation:${access.conversation.id}:topology`,
            `thread:${child.id}:context`,
          ],
        },
        events: [
          {
            id: eventId,
            aggregateType: "conversation",
            aggregateId: access.conversation.id,
            aggregateRevision: nextRevision,
            type: "ThreadForked",
            payload: asJson({
              threadId: child.id,
              parentThreadId: access.thread.id,
              sourceMessageId: source.message.id,
            }),
          },
        ],
      }
    })
  }

  sendTurn(command: CommandEnvelope<SendTurnPayload>): Promise<CommandCommit> {
    return this.execute("sendTurn", command, async (transaction) => {
      if (command.scope.type !== "thread")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Thread"
        )
      const access = await findThreadAccess(
        transaction,
        command.actor.userId,
        command.scope.id,
        { conversation: "share", thread: "update" }
      )
      if (!access || access.conversation.id !== command.payload.conversationId)
        throw new ConversationCommandError("not_found", "Thread 不存在")
      assertExpectedRevision(
        access.thread.revision,
        command.expectedRevision,
        "Thread"
      )
      if (
        access.thread.lifecycle !== "active" ||
        access.conversation.lifecycle !== "active"
      )
        throw new ConversationCommandError(
          "state_conflict",
          "归档资源不能发送消息"
        )
      const [positionRow] = await transaction
        .select({ value: max(conversationTurns.position) })
        .from(conversationTurns)
        .where(eq(conversationTurns.threadId, access.thread.id))
      const position = (positionRow?.value ?? -1) + 1
      const now = this.now()
      const userMessage = mapMessage({
        id: command.payload.userMessageId,
        threadId: access.thread.id,
        turnId: command.payload.turnId,
        role: "user",
        content: command.payload.content,
        contentState: "complete",
        variantOfMessageId: null,
        createdAt: now,
      })
      const assistantMessage = mapMessage({
        id: command.payload.assistantMessageId,
        threadId: access.thread.id,
        turnId: command.payload.turnId,
        role: "assistant",
        content: { schemaVersion: 1, parts: [] },
        contentState: "pending",
        variantOfMessageId: null,
        createdAt: now,
      })
      const turn: ConversationTurn = {
        id: command.payload.turnId,
        threadId: threadId(access.thread.id),
        position,
        activeUserMessageId: userMessage.id,
        activeAssistantMessageId: assistantMessage.id,
        revision: 0,
      }
      await transaction.insert(conversationTurns).values({
        id: turn.id,
        threadId: turn.threadId,
        position,
        activeUserMessageId: userMessage.id,
        activeAssistantMessageId: assistantMessage.id,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      })
      await transaction.insert(conversationMessages).values([
        {
          id: userMessage.id,
          threadId: userMessage.threadId,
          turnId: userMessage.turnId,
          role: "user",
          content: userMessage.content,
          contentState: "complete",
          createdAt: now,
        },
        {
          id: assistantMessage.id,
          threadId: assistantMessage.threadId,
          turnId: assistantMessage.turnId,
          role: "assistant",
          content: assistantMessage.content,
          contentState: "pending",
          createdAt: now,
        },
      ])
      const eventId = this.id()
      const generation = await insertGeneration(transaction, {
        access,
        actorUserId: command.actor.userId,
        generationId: command.payload.generationId,
        turnId: turn.id,
        inputMessageId: userMessage.id,
        outputMessageId: assistantMessage.id,
        intent: { kind: "send" },
        requestHash: commandPayloadHash({
          commandType: "sendTurn",
          expectedRevision: command.expectedRevision,
          payload: command.payload,
        }),
        idempotencyKey: scopedGenerationKey(command),
        modelId: command.payload.modelId,
        leaseOwner: eventId,
        now,
      })
      const nextThreadRevision = access.thread.revision + 1
      await transaction
        .update(conversationThreads)
        .set({ revision: nextThreadRevision, updatedAt: now })
        .where(eq(conversationThreads.id, access.thread.id))
      return generationMutation({
        command,
        access,
        eventId,
        eventAggregateRevision: 0,
        generation,
        turn,
        messages: [userMessage, assistantMessage],
        revisions: {
          [access.thread.id]: nextThreadRevision,
          [turn.id]: 0,
        },
      })
    })
  }

  editTurnInput(
    command: CommandEnvelope<EditTurnInputPayload>
  ): Promise<CommandCommit> {
    return this.execute("editTurnInput", command, async (transaction) => {
      if (command.scope.type !== "turn")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Turn"
        )
      const access = await findTurnCommandAccess(
        transaction,
        command.actor.userId,
        command.scope.id
      )
      if (!access || access.conversation.id !== command.payload.conversationId)
        throw new ConversationCommandError("not_found", "Turn 不存在")
      assertExpectedRevision(
        access.turn.revision,
        command.expectedRevision,
        "Turn"
      )
      const [last] = await transaction
        .select({ value: max(conversationTurns.position) })
        .from(conversationTurns)
        .where(eq(conversationTurns.threadId, access.thread.id))
      if (last?.value !== access.turn.position)
        throw new ConversationCommandError(
          "fork_required",
          "编辑已有后续内容的 Turn 必须显式 Fork"
        )
      const [source] = await transaction
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, command.payload.sourceUserMessageId),
            eq(conversationMessages.turnId, access.turn.id),
            eq(conversationMessages.threadId, access.thread.id),
            eq(conversationMessages.role, "user")
          )
        )
        .limit(1)
      if (!source || access.turn.activeUserMessageId !== source.id)
        throw new ConversationCommandError(
          "semantic_validation",
          "只能编辑当前有效用户 Message"
        )
      const now = this.now()
      const userMessage = mapMessage({
        id: command.payload.userMessageId,
        threadId: access.thread.id,
        turnId: access.turn.id,
        role: "user",
        content: command.payload.content,
        contentState: "complete",
        variantOfMessageId: source.id,
        createdAt: now,
      })
      const assistantMessage = mapMessage({
        id: command.payload.assistantMessageId,
        threadId: access.thread.id,
        turnId: access.turn.id,
        role: "assistant",
        content: { schemaVersion: 1, parts: [] },
        contentState: "pending",
        variantOfMessageId: access.turn.activeAssistantMessageId,
        createdAt: now,
      })
      await transaction.insert(conversationMessages).values([
        {
          ...userMessage,
          variantOfMessageId: source.id,
          createdAt: now,
        },
        {
          ...assistantMessage,
          variantOfMessageId: access.turn.activeAssistantMessageId,
          createdAt: now,
        },
      ])
      await supersedeCurrentGeneration(transaction, access.turn.id, now)
      const eventId = this.id()
      const generation = await insertGeneration(transaction, {
        access,
        actorUserId: command.actor.userId,
        generationId: command.payload.generationId,
        turnId: turnId(access.turn.id),
        inputMessageId: userMessage.id,
        outputMessageId: assistantMessage.id,
        intent: {
          kind: "edit-user",
          sourceUserMessageId: messageId(source.id),
        },
        requestHash: commandPayloadHash({
          commandType: "editTurnInput",
          expectedRevision: command.expectedRevision,
          payload: command.payload,
        }),
        idempotencyKey: scopedGenerationKey(command),
        modelId: command.payload.modelId,
        leaseOwner: eventId,
        now,
      })
      const nextTurnRevision = access.turn.revision + 1
      await transaction
        .update(conversationTurns)
        .set({
          activeUserMessageId: userMessage.id,
          revision: nextTurnRevision,
          updatedAt: now,
        })
        .where(eq(conversationTurns.id, access.turn.id))
      const updatedTurn = mapTurn({
        ...access.turn,
        activeUserMessageId: userMessage.id,
        revision: nextTurnRevision,
        updatedAt: now,
      })
      return generationMutation({
        command,
        access,
        eventId,
        eventAggregateRevision: nextTurnRevision,
        generation,
        turn: updatedTurn,
        messages: [userMessage, assistantMessage],
        revisions: { [updatedTurn.id]: nextTurnRevision },
      })
    })
  }

  regenerateTurn(
    command: CommandEnvelope<RegenerateTurnPayload>
  ): Promise<CommandCommit> {
    return this.execute("regenerateTurn", command, async (transaction) => {
      if (command.scope.type !== "turn")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Turn"
        )
      const access = await findTurnCommandAccess(
        transaction,
        command.actor.userId,
        command.scope.id
      )
      if (!access || access.conversation.id !== command.payload.conversationId)
        throw new ConversationCommandError("not_found", "Turn 不存在")
      assertExpectedRevision(
        access.turn.revision,
        command.expectedRevision,
        "Turn"
      )
      const [source] = await transaction
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(
              conversationMessages.id,
              command.payload.sourceAssistantMessageId
            ),
            eq(conversationMessages.turnId, access.turn.id),
            eq(conversationMessages.threadId, access.thread.id),
            eq(conversationMessages.role, "assistant")
          )
        )
        .limit(1)
      if (!source)
        throw new ConversationCommandError(
          "semantic_validation",
          "重新生成来源不是同 Turn 助手 Message"
        )
      const now = this.now()
      const assistantMessage = mapMessage({
        id: command.payload.assistantMessageId,
        threadId: access.thread.id,
        turnId: access.turn.id,
        role: "assistant",
        content: { schemaVersion: 1, parts: [] },
        contentState: "pending",
        variantOfMessageId: source.id,
        createdAt: now,
      })
      await transaction.insert(conversationMessages).values({
        ...assistantMessage,
        variantOfMessageId: source.id,
        createdAt: now,
      })
      await supersedeCurrentGeneration(transaction, access.turn.id, now)
      const eventId = this.id()
      const generation = await insertGeneration(transaction, {
        access,
        actorUserId: command.actor.userId,
        generationId: command.payload.generationId,
        turnId: turnId(access.turn.id),
        inputMessageId: messageId(access.turn.activeUserMessageId),
        outputMessageId: assistantMessage.id,
        intent: {
          kind: "regenerate-assistant",
          sourceAssistantMessageId: messageId(source.id),
        },
        requestHash: commandPayloadHash({
          commandType: "regenerateTurn",
          expectedRevision: command.expectedRevision,
          payload: command.payload,
        }),
        idempotencyKey: scopedGenerationKey(command),
        modelId: command.payload.modelId,
        leaseOwner: eventId,
        now,
      })
      const nextTurnRevision = access.turn.revision + 1
      await transaction
        .update(conversationTurns)
        .set({ revision: nextTurnRevision, updatedAt: now })
        .where(eq(conversationTurns.id, access.turn.id))
      const updatedTurn = mapTurn({
        ...access.turn,
        revision: nextTurnRevision,
        updatedAt: now,
      })
      return generationMutation({
        command,
        access,
        eventId,
        eventAggregateRevision: nextTurnRevision,
        generation,
        turn: updatedTurn,
        messages: [assistantMessage],
        revisions: { [updatedTurn.id]: nextTurnRevision },
      })
    })
  }

  selectTurnVariant(
    command: CommandEnvelope<SelectTurnVariantPayload>
  ): Promise<CommandCommit> {
    return this.execute("selectTurnVariant", command, async (transaction) => {
      if (command.scope.type !== "turn")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Turn"
        )
      const access = await findTurnCommandAccess(
        transaction,
        command.actor.userId,
        command.scope.id
      )
      if (!access || access.conversation.id !== command.payload.conversationId)
        throw new ConversationCommandError("not_found", "Turn 不存在")
      assertExpectedRevision(
        access.turn.revision,
        command.expectedRevision,
        "Turn"
      )
      const [selected] = await transaction
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, command.payload.messageId),
            eq(conversationMessages.turnId, access.turn.id),
            eq(conversationMessages.threadId, access.thread.id),
            eq(conversationMessages.role, command.payload.role)
          )
        )
        .limit(1)
      if (
        !selected ||
        !["complete", "incomplete"].includes(selected.contentState)
      )
        throw new ConversationCommandError(
          "semantic_validation",
          "目标 Message 不是同 Turn 可用角色变体"
        )
      const nextTurnRevision = access.turn.revision + 1
      const now = this.now()
      await transaction
        .update(conversationTurns)
        .set({
          ...(command.payload.role === "user"
            ? { activeUserMessageId: selected.id }
            : { activeAssistantMessageId: selected.id }),
          revision: nextTurnRevision,
          updatedAt: now,
        })
        .where(eq(conversationTurns.id, access.turn.id))
      const updatedTurn = mapTurn({
        ...access.turn,
        ...(command.payload.role === "user"
          ? { activeUserMessageId: selected.id }
          : { activeAssistantMessageId: selected.id }),
        revision: nextTurnRevision,
        updatedAt: now,
      })
      const eventId = this.id()
      return {
        data: asJson({ turnId: updatedTurn.id, messageId: selected.id }),
        revisions: { [updatedTurn.id]: nextTurnRevision },
        delta: {
          upsert: { turns: [updatedTurn] },
          remove: {},
          invalidate: [`thread:${access.thread.id}:context`],
        },
        events: [
          {
            id: eventId,
            aggregateType: "turn",
            aggregateId: updatedTurn.id,
            aggregateRevision: nextTurnRevision,
            type: "TurnVariantSelected",
            payload: asJson({
              messageId: selected.id,
              role: command.payload.role,
            }),
          },
        ],
      }
    })
  }

  private mutateConversation<TPayload>(
    commandType: string,
    command: CommandEnvelope<TPayload>,
    mutation: (
      transaction: CommandTransaction,
      access: ConversationAccess
    ) => Promise<CommandMutation>
  ): Promise<CommandCommit> {
    return this.execute(commandType, command, async (transaction) => {
      if (command.scope.type !== "conversation")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Conversation"
        )
      const access = await findConversationAccess(
        transaction,
        command.actor.userId,
        command.scope.id,
        true
      )
      if (!access)
        throw new ConversationCommandError("not_found", "Conversation 不存在")
      assertExpectedRevision(
        access.conversation.revision,
        command.expectedRevision,
        "Conversation"
      )
      return mutation(transaction, access)
    })
  }

  private mutateThread<TPayload>(
    commandType: string,
    command: CommandEnvelope<TPayload>,
    mutation: (
      transaction: CommandTransaction,
      access: ThreadAccess
    ) => Promise<CommandMutation>
  ): Promise<CommandCommit> {
    return this.execute(commandType, command, async (transaction) => {
      if (command.scope.type !== "thread")
        throw new ConversationCommandError(
          "invalid_request",
          "命令 scope 必须是 Thread"
        )
      const access = await findThreadAccess(
        transaction,
        command.actor.userId,
        command.scope.id,
        { conversation: "share", thread: "update" }
      )
      if (!access)
        throw new ConversationCommandError("not_found", "Thread 不存在")
      assertExpectedRevision(
        access.thread.revision,
        command.expectedRevision,
        "Thread"
      )
      return mutation(transaction, access)
    })
  }

  private async execute<TPayload>(
    commandType: string,
    command: CommandEnvelope<TPayload>,
    mutation: (transaction: CommandTransaction) => Promise<CommandMutation>
  ): Promise<CommandCommit> {
    assertConversationCommandApiEnabled(this.policy)
    if (!command.idempotencyKey || command.idempotencyKey.length > 200)
      throw new ConversationCommandError(
        "invalid_request",
        "幂等键必须为 1–200 字符",
        { field: "Idempotency-Key" }
      )
    const payloadHash = commandPayloadHash({
      commandType,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    })
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtext(${command.actor.userId}),
          hashtext(${`${command.scope.type}:${command.scope.id}:${command.idempotencyKey}`})
        )
      `)
      const [existing] = await transaction
        .select()
        .from(conversationCommandRecords)
        .where(
          and(
            eq(conversationCommandRecords.actorId, command.actor.userId),
            eq(conversationCommandRecords.scopeType, command.scope.type),
            eq(conversationCommandRecords.scopeId, command.scope.id),
            eq(
              conversationCommandRecords.idempotencyKey,
              command.idempotencyKey
            )
          )
        )
        .limit(1)
      if (existing) {
        if (
          existing.commandType !== commandType ||
          existing.payloadHash !== payloadHash
        )
          throw new ConversationCommandError(
            "idempotency_conflict",
            "幂等键已绑定不同命令载荷"
          )
        const result = existing.result as unknown as CommandSuccess
        return { result: { ...result, replayed: true }, outboxEventIds: [] }
      }

      const mutated = await mutation(transaction)
      const result: CommandSuccess = {
        schemaVersion: CONVERSATION_COMMAND_SCHEMA_VERSION,
        data: mutated.data,
        revisions: mutated.revisions,
        delta: mutated.delta,
        replayed: false,
      }
      const events = mutated.events ?? []
      if (events.length > 0)
        await transaction.insert(conversationOutboxEvents).values(
          events.map((event) => ({
            ...event,
            schemaVersion: CONVERSATION_COMMAND_SCHEMA_VERSION,
            actorId: command.actor.userId,
            status: "pending",
            attempts: 0,
            availableAt: sql`CURRENT_TIMESTAMP`,
            createdAt: sql`CURRENT_TIMESTAMP`,
          }))
        )
      await transaction.insert(conversationCommandRecords).values({
        id: command.commandId,
        actorId: command.actor.userId,
        scopeType: command.scope.type,
        scopeId: command.scope.id,
        commandType,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        result: asJson(result),
        createdAt: sql`CURRENT_TIMESTAMP`,
      })
      return {
        result,
        outboxEventIds: events.map((event) => event.id),
      }
    })
  }
}

function conversationNoopMutation(
  row: typeof conversations.$inferSelect
): CommandMutation {
  const conversation = mapConversation(row)
  return {
    data: asJson({
      conversationId: conversation.id,
      lifecycle: conversation.lifecycle,
    }),
    revisions: { [conversation.id]: conversation.revision },
    delta: {
      upsert: { conversations: [conversation] },
      remove: {},
      invalidate: [],
    },
  }
}

function threadMutation(
  thread: ConversationThread,
  targetConversationId: string
): CommandMutation {
  return {
    data: asJson({ threadId: thread.id, lifecycle: thread.lifecycle }),
    revisions: { [thread.id]: thread.revision },
    delta: {
      upsert: { threads: [thread] },
      remove: {},
      invalidate: [`conversation:${targetConversationId}:threads`],
    },
  }
}

interface TurnCommandAccess extends ThreadAccess {
  readonly turn: typeof conversationTurns.$inferSelect
}

async function findTurnCommandAccess(
  transaction: CommandTransaction,
  actorUserId: string,
  targetTurnId: string
): Promise<TurnCommandAccess | null> {
  const query = transaction
    .select({
      turn: conversationTurns,
      thread: conversationThreads,
      conversation: conversations,
      project: projects,
    })
    .from(conversationTurns)
    .innerJoin(
      conversationThreads,
      eq(conversationThreads.id, conversationTurns.threadId)
    )
    .innerJoin(
      conversations,
      eq(conversations.id, conversationThreads.conversationId)
    )
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, actorUserId)
      )
    )
    .where(eq(conversationTurns.id, targetTurnId))
    .limit(1)
  const [authorized] = await query
  if (!authorized) return null
  await transaction
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, authorized.conversation.id))
    .for("share")
  await transaction
    .select({ id: conversationThreads.id })
    .from(conversationThreads)
    .where(eq(conversationThreads.id, authorized.thread.id))
    .for("update")
  await transaction
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .where(eq(conversationTurns.id, targetTurnId))
    .for("update")
  const [fresh] = await query
  return fresh ?? null
}

function scopedGenerationKey<TPayload>(
  command: CommandEnvelope<TPayload>
): string {
  return `${command.scope.type}:${command.scope.id}:${command.idempotencyKey}`
}

async function supersedeCurrentGeneration(
  transaction: CommandTransaction,
  targetTurnId: string,
  now: Date
): Promise<void> {
  const currentRows = await transaction
    .select()
    .from(conversationGenerations)
    .where(
      and(
        eq(conversationGenerations.turnId, targetTurnId),
        eq(conversationGenerations.isCurrent, true)
      )
    )
  for (const current of currentRows) {
    if (ACTIVE_GENERATION_STATUSES.includes(current.status as never)) {
      const checkpoint = parseConversationGenerationCheckpoint(
        current.checkpoint
      )
      const contentState = hasRecoverableCheckpointOutput(checkpoint)
        ? "incomplete"
        : "failed"
      await transaction
        .update(conversationMessages)
        .set({ contentState })
        .where(eq(conversationMessages.id, current.outputMessageId))
      await transaction
        .update(conversationGenerations)
        .set({
          isCurrent: false,
          status: "superseded",
          contentState,
          usageCompleteness: "unavailable",
          billingStatus: current.paidCallStarted
            ? "usage_unavailable"
            : "not_billable",
          leaseOwner: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(conversationGenerations.id, current.id))
      continue
    }
    await transaction
      .update(conversationGenerations)
      .set({ isCurrent: false, updatedAt: now })
      .where(eq(conversationGenerations.id, current.id))
  }
}

async function insertGeneration(
  transaction: CommandTransaction,
  input: {
    readonly access: ThreadAccess
    readonly actorUserId: string
    readonly generationId: GenerationId
    readonly turnId: ReturnType<typeof turnId>
    readonly inputMessageId: MessageId
    readonly outputMessageId: MessageId
    readonly intent: GenerationIntent
    readonly requestHash: string
    readonly idempotencyKey: string
    readonly modelId: string
    readonly leaseOwner: string
    readonly now: Date
  }
): Promise<ConversationGeneration> {
  const [attemptRow] = await transaction
    .select({ value: max(conversationGenerations.attempt) })
    .from(conversationGenerations)
    .where(eq(conversationGenerations.turnId, input.turnId))
  const attempt = (attemptRow?.value ?? 0) + 1
  const checkpoint = emptyConversationGenerationCheckpoint()
  const [created] = await transaction
    .insert(conversationGenerations)
    .values({
      id: input.generationId,
      ownerId: input.actorUserId,
      workspaceId: input.access.project.workspaceId,
      projectId: input.access.project.id,
      conversationId: input.access.conversation.id,
      threadId: input.access.thread.id,
      turnId: input.turnId,
      inputMessageId: input.inputMessageId,
      outputMessageId: input.outputMessageId,
      intent: input.intent,
      requestHash: input.requestHash,
      idempotencyKey: input.idempotencyKey,
      modelId: input.modelId,
      attempt,
      isCurrent: true,
      status: "running",
      contentState: "pending",
      checkpointVersion: 0,
      checkpoint,
      knownUsage: null,
      usageCompleteness: "unavailable",
      billingStatus: "pending",
      paidCallStarted: false,
      leaseOwner: input.leaseOwner,
      heartbeatAt: input.now,
      startedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning()
  if (!created)
    throw new ConversationCommandError(
      "internal",
      "Generation 创建事务未返回实体"
    )
  return mapGenerationSummary(created)
}

function generationMutation<TPayload>(input: {
  readonly command: CommandEnvelope<TPayload>
  readonly access: ThreadAccess
  readonly eventId: string
  readonly eventAggregateRevision: number
  readonly generation: ConversationGeneration
  readonly turn: ConversationTurn
  readonly messages: readonly ConversationMessage[]
  readonly revisions: Readonly<Record<string, number>>
}): CommandMutation {
  return {
    data: asJson({
      turnId: input.turn.id,
      generationId: input.generation.id,
    }),
    revisions: input.revisions,
    delta: {
      upsert: {
        turns: [input.turn],
        messages: input.messages,
        generations: [input.generation],
      },
      remove: {},
      invalidate: [`thread:${input.access.thread.id}:context`],
    },
    events: [
      {
        id: input.eventId,
        aggregateType: "turn",
        aggregateId: input.turn.id,
        aggregateRevision: input.eventAggregateRevision,
        type: "GenerationRequested",
        payload: asJson({
          generationId: input.generation.id,
          ownerId: input.command.actor.userId,
          leaseOwner: input.eventId,
        }),
      },
    ],
  }
}

function deriveContextMessageIds(input: {
  readonly threads: readonly ConversationThread[]
  readonly turns: readonly ConversationTurn[]
  readonly messages: readonly ConversationMessage[]
  readonly forks: readonly ThreadFork[]
  readonly generations: readonly ConversationGeneration[]
}): Readonly<Record<string, readonly MessageId[]>> {
  const forkByChild = new Map(
    input.forks.map((fork) => [fork.childThreadId, fork])
  )
  const turnsByThread = new Map<string, ConversationTurn[]>()
  for (const turn of input.turns) {
    const values = turnsByThread.get(turn.threadId) ?? []
    values.push(turn)
    turnsByThread.set(turn.threadId, values)
  }
  for (const values of turnsByThread.values())
    values.sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id)
    )
  const local = (targetThreadId: ThreadId): MessageId[] =>
    (turnsByThread.get(targetThreadId) ?? []).flatMap((turn) => [
      turn.activeUserMessageId,
      turn.activeAssistantMessageId,
    ])
  const messagesById = new Map(
    input.messages.map((message) => [message.id, message])
  )
  const turnsById = new Map(input.turns.map((turn) => [turn.id, turn]))
  const generationByOutput = new Map(
    input.generations.map((generation) => [
      generation.outputMessageId,
      generation,
    ])
  )
  const localThroughSource = (
    targetThreadId: ThreadId,
    sourceMessageId: MessageId
  ): MessageId[] => {
    const source = messagesById.get(sourceMessageId)
    const sourceTurn = source ? turnsById.get(source.turnId) : undefined
    if (!source || !sourceTurn || source.threadId !== targetThreadId)
      throw new ConversationCommandError(
        "internal",
        "ThreadFork 来源 Message 无法解析"
      )
    const before = (turnsByThread.get(targetThreadId) ?? [])
      .filter((turn) => turn.position < sourceTurn.position)
      .flatMap((turn) => [
        turn.activeUserMessageId,
        turn.activeAssistantMessageId,
      ])
    if (source.role === "user") return [...before, source.id]
    const inputMessageId =
      generationByOutput.get(source.id)?.inputMessageId ??
      sourceTurn.activeUserMessageId
    return [...before, inputMessageId, source.id]
  }
  const inheritedMemo = new Map<string, MessageId[]>()
  const visiting = new Set<string>()
  const inherited = (targetThreadId: ThreadId): MessageId[] => {
    const cached = inheritedMemo.get(targetThreadId)
    if (cached) return cached
    if (visiting.has(targetThreadId))
      throw new ConversationCommandError(
        "internal",
        "ThreadFork 读取投影检测到环"
      )
    visiting.add(targetThreadId)
    const fork = forkByChild.get(targetThreadId)
    const value = fork
      ? [
          ...inherited(fork.parentThreadId),
          ...localThroughSource(fork.parentThreadId, fork.sourceMessageId),
        ]
      : []
    visiting.delete(targetThreadId)
    inheritedMemo.set(targetThreadId, value)
    return value
  }
  return Object.fromEntries(
    input.threads.map((thread) => [
      thread.id,
      [...inherited(thread.id), ...local(thread.id)],
    ])
  )
}
