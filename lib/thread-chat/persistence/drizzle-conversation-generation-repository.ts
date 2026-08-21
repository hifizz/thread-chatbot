import { isDeepStrictEqual } from "node:util"
import { and, eq, inArray, lt, max, sql } from "drizzle-orm"

import { chargeUsageOnce } from "../../billing/credits"
import { db } from "../../db"
import {
  conversationGenerations,
  conversationMessages,
  conversationThreads,
  conversationTurns,
  conversations,
  projects,
  workspaceMembers,
} from "../../db/schema"
import type {
  CanonicalGenerationRecord,
  CanonicalGenerationRepository,
  FinalizeCanonicalGenerationInput,
  StartCanonicalGenerationInput,
  StartCanonicalGenerationResult,
} from "../application/conversation-generation-service"
import {
  CanonicalGenerationServiceError,
  expectedBillingStatus,
} from "../application/conversation-generation-service"
import {
  checkpointMessageContent,
  hasRecoverableCheckpointOutput,
  inferUsageCompleteness,
  parseConversationGenerationCheckpoint,
  terminalMessageContentState,
} from "../domain/conversation-generation"
import {
  conversationId,
  generationId,
  messageId,
  projectId,
  threadId,
  turnId,
  workspaceId,
} from "../domain/conversation-model"
import {
  assertCanonicalGenerationEnabled,
  resolveCanonicalGenerationPolicy,
  type CanonicalGenerationPolicy,
} from "./canonical-generation-policy"

const ACTIVE_STATUSES = ["running", "stop_requested"] as const

type GenerationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function mapGeneration(
  row: typeof conversationGenerations.$inferSelect
): CanonicalGenerationRecord {
  return {
    id: generationId(row.id),
    ownerId: row.ownerId,
    workspaceId: workspaceId(row.workspaceId),
    projectId: projectId(row.projectId),
    conversationId: conversationId(row.conversationId),
    threadId: threadId(row.threadId),
    turnId: turnId(row.turnId),
    inputMessageId: messageId(row.inputMessageId),
    outputMessageId: messageId(row.outputMessageId),
    intent: row.intent,
    requestHash: row.requestHash,
    idempotencyKey: row.idempotencyKey,
    modelId: row.modelId,
    attempt: row.attempt,
    isCurrent: row.isCurrent,
    status: row.status,
    contentState: row.contentState,
    billingStatus: row.billingStatus,
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
    createdAt: row.createdAt.toISOString(),
  }
}

function replayMatches(
  row: typeof conversationGenerations.$inferSelect,
  input: StartCanonicalGenerationInput
): boolean {
  return (
    row.id === input.id &&
    row.ownerId === input.ownerId &&
    row.workspaceId === input.workspaceId &&
    row.projectId === input.projectId &&
    row.conversationId === input.conversationId &&
    row.threadId === input.threadId &&
    row.turnId === input.turnId &&
    row.inputMessageId === input.inputMessageId &&
    row.outputMessageId === input.outputMessage.id &&
    row.requestHash === input.requestHash &&
    row.modelId === input.modelId &&
    JSON.stringify(row.intent) === JSON.stringify(input.intent)
  )
}

function checkpointExtends(currentValue: unknown, nextValue: unknown): boolean {
  const current = parseConversationGenerationCheckpoint(currentValue)
  const next = parseConversationGenerationCheckpoint(nextValue)
  if (!next.body.startsWith(current.body)) return false
  if (
    current.artifactIds.some(
      (artifactId) => !next.artifactIds.includes(artifactId)
    )
  )
    return false
  const currentUsage = current.knownUsage
  const nextUsage = next.knownUsage
  if (
    currentUsage &&
    (!nextUsage ||
      nextUsage.inputTokens < currentUsage.inputTokens ||
      nextUsage.outputTokens < currentUsage.outputTokens ||
      nextUsage.reportedStepCount < currentUsage.reportedStepCount)
  )
    return false
  if (current.researchPlan !== null && next.researchPlan === null) return false
  const nextActivities = new Map(
    next.researchActivities.map((activity) => [activity.id, activity])
  )
  for (const activity of current.researchActivities) {
    const candidate = nextActivities.get(activity.id)
    if (!candidate || candidate.kind !== activity.kind) return false
    if (activity.status !== "running" && candidate.status !== activity.status)
      return false
    if (
      activity.sources.some(
        (source) =>
          !candidate.sources.some(
            (candidateSource) => candidateSource.url === source.url
          )
      )
    )
      return false
    if (activity.error && !candidate.error) return false
  }
  return true
}

async function lockGeneration(
  transaction: GenerationTransaction,
  targetGenerationId: string
): Promise<typeof conversationGenerations.$inferSelect | null> {
  const locked = await transaction.execute(sql`
    select ${conversationGenerations.id}
    from ${conversationGenerations}
    where ${conversationGenerations.id} = ${targetGenerationId}
    for update
  `)
  if (locked.length === 0) return null
  const [row] = await transaction
    .select()
    .from(conversationGenerations)
    .where(eq(conversationGenerations.id, targetGenerationId))
    .limit(1)
  return row ?? null
}

export class DrizzleConversationGenerationRepository implements CanonicalGenerationRepository {
  readonly policy: CanonicalGenerationPolicy

  constructor(
    policy: CanonicalGenerationPolicy = resolveCanonicalGenerationPolicy()
  ) {
    this.policy = policy
  }

  async startGeneration(
    input: StartCanonicalGenerationInput
  ): Promise<StartCanonicalGenerationResult> {
    assertCanonicalGenerationEnabled(this.policy)
    if (
      input.outputMessage.threadId !== input.threadId ||
      input.outputMessage.turnId !== input.turnId ||
      input.outputMessage.contentState !== "pending"
    )
      throw new CanonicalGenerationServiceError(
        "invalid_identity",
        "输出 Message 必须是同一 Thread/Turn 的 pending 占位"
      )

    return db.transaction(async (transaction) => {
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtext(${input.ownerId}),
          hashtext(${input.idempotencyKey})
        )
      `)
      const [replayed] = await transaction
        .select()
        .from(conversationGenerations)
        .where(
          and(
            eq(conversationGenerations.ownerId, input.ownerId),
            eq(conversationGenerations.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1)
      if (replayed) {
        if (!replayMatches(replayed, input))
          throw new CanonicalGenerationServiceError(
            "idempotency_conflict",
            "幂等键已绑定不同 Generation 载荷"
          )
        return { created: false, generation: mapGeneration(replayed) }
      }

      const [identity] = await transaction
        .select({
          turnRevision: conversationTurns.revision,
          activeAssistantMessageId: conversationTurns.activeAssistantMessageId,
          inputRole: conversationMessages.role,
          inputVariantOfMessageId: conversationMessages.variantOfMessageId,
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
            eq(workspaceMembers.userId, input.ownerId)
          )
        )
        .innerJoin(
          conversationMessages,
          and(
            eq(conversationMessages.id, input.inputMessageId),
            eq(conversationMessages.turnId, conversationTurns.id),
            eq(conversationMessages.threadId, conversationTurns.threadId)
          )
        )
        .where(
          and(
            eq(conversationTurns.id, input.turnId),
            eq(conversationTurns.threadId, input.threadId),
            eq(conversationThreads.conversationId, input.conversationId),
            eq(conversations.projectId, input.projectId),
            eq(projects.workspaceId, input.workspaceId)
          )
        )
        .limit(1)
      if (!identity || identity.inputRole !== "user")
        throw new CanonicalGenerationServiceError(
          "invalid_identity",
          "Generation 规范实体归属或输入 Message 角色无效"
        )
      if (identity.turnRevision !== input.expectedTurnRevision)
        throw new CanonicalGenerationServiceError(
          "version_conflict",
          "Turn revision 已变化"
        )

      const [existingOutput] = await transaction
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, input.outputMessage.id))
        .limit(1)
      if (
        existingOutput &&
        (existingOutput.threadId !== input.threadId ||
          existingOutput.turnId !== input.turnId ||
          existingOutput.role !== "assistant" ||
          existingOutput.contentState !== "pending" ||
          !isDeepStrictEqual(
            existingOutput.content,
            input.outputMessage.content
          ) ||
          existingOutput.variantOfMessageId !==
            (input.outputMessage.variantOfMessageId ?? null))
      )
        throw new CanonicalGenerationServiceError(
          "invalid_identity",
          "既有输出 Message 不是可确认的同 Turn pending 占位"
        )

      if (input.intent.kind === "regenerate-assistant") {
        const [source] = await transaction
          .select({ role: conversationMessages.role })
          .from(conversationMessages)
          .where(
            and(
              eq(
                conversationMessages.id,
                input.intent.sourceAssistantMessageId
              ),
              eq(conversationMessages.threadId, input.threadId),
              eq(conversationMessages.turnId, input.turnId)
            )
          )
          .limit(1)
        if (
          source?.role !== "assistant" ||
          input.outputMessage.variantOfMessageId !==
            input.intent.sourceAssistantMessageId
        )
          throw new CanonicalGenerationServiceError(
            "invalid_identity",
            "重新生成来源与输出 Message 变体关系不一致"
          )
      }
      if (input.intent.kind === "edit-user") {
        const [source] = await transaction
          .select({ role: conversationMessages.role })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.id, input.intent.sourceUserMessageId),
              eq(conversationMessages.threadId, input.threadId),
              eq(conversationMessages.turnId, input.turnId)
            )
          )
          .limit(1)
        if (
          source?.role !== "user" ||
          input.inputMessageId === input.intent.sourceUserMessageId ||
          identity.inputVariantOfMessageId !== input.intent.sourceUserMessageId
        )
          throw new CanonicalGenerationServiceError(
            "invalid_identity",
            "编辑用户消息来源与输入 Message 变体关系不一致"
          )
      }

      const now = new Date()
      const currentRows = await transaction
        .select()
        .from(conversationGenerations)
        .where(
          and(
            eq(conversationGenerations.turnId, input.turnId),
            eq(conversationGenerations.isCurrent, true)
          )
        )
      for (const current of currentRows) {
        if (ACTIVE_STATUSES.includes(current.status as never)) {
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

      if (!existingOutput)
        await transaction.insert(conversationMessages).values({
          id: input.outputMessage.id,
          threadId: input.threadId,
          turnId: input.turnId,
          role: "assistant",
          content: input.outputMessage.content,
          contentState: "pending",
          variantOfMessageId:
            input.outputMessage.variantOfMessageId ??
            identity.activeAssistantMessageId,
          createdAt: new Date(input.outputMessage.createdAt),
        })
      const [attemptRow] = await transaction
        .select({ value: max(conversationGenerations.attempt) })
        .from(conversationGenerations)
        .where(eq(conversationGenerations.turnId, input.turnId))
      const attempt = (attemptRow?.value ?? 0) + 1
      const checkpoint = parseConversationGenerationCheckpoint({
        schemaVersion: 1,
        body: "",
        artifactIds: [],
        researchPlan: null,
        researchActivities: [],
        contentState: "pending",
        knownUsage: null,
      })
      const [created] = await transaction
        .insert(conversationGenerations)
        .values({
          id: input.id,
          ownerId: input.ownerId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          threadId: input.threadId,
          turnId: input.turnId,
          inputMessageId: input.inputMessageId,
          outputMessageId: input.outputMessage.id,
          intent: input.intent,
          requestHash: input.requestHash,
          idempotencyKey: input.idempotencyKey,
          modelId: input.modelId,
          attempt,
          status: "running",
          contentState: "pending",
          checkpoint,
          usageCompleteness: "unavailable",
          billingStatus: "pending",
          leaseOwner: input.leaseOwner,
          heartbeatAt: now,
          startedAt: now,
        })
        .returning()
      const [updatedTurn] = await transaction
        .update(conversationTurns)
        .set({
          revision: sql`${conversationTurns.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationTurns.id, input.turnId),
            eq(conversationTurns.revision, input.expectedTurnRevision)
          )
        )
        .returning({ id: conversationTurns.id })
      if (!created || !updatedTurn)
        throw new CanonicalGenerationServiceError(
          "version_conflict",
          "Generation 开始事务未能提交"
        )
      return { created: true, generation: mapGeneration(created) }
    })
  }

  async markPaidCallStarted(input: {
    readonly generationId: ReturnType<typeof generationId>
    readonly leaseOwner: string
  }): Promise<boolean> {
    assertCanonicalGenerationEnabled(this.policy)
    const [updated] = await db
      .update(conversationGenerations)
      .set({ paidCallStarted: true, updatedAt: new Date() })
      .where(
        and(
          eq(conversationGenerations.id, input.generationId),
          eq(conversationGenerations.leaseOwner, input.leaseOwner),
          eq(conversationGenerations.status, "running")
        )
      )
      .returning({ id: conversationGenerations.id })
    return Boolean(updated)
  }

  async getGeneration(input: {
    readonly ownerId: string
    readonly generationId: ReturnType<typeof generationId>
  }): Promise<CanonicalGenerationRecord | null> {
    const [row] = await db
      .select()
      .from(conversationGenerations)
      .where(
        and(
          eq(conversationGenerations.id, input.generationId),
          eq(conversationGenerations.ownerId, input.ownerId)
        )
      )
      .limit(1)
    return row ? mapGeneration(row) : null
  }

  async saveCheckpoint(input: {
    readonly generationId: ReturnType<typeof generationId>
    readonly leaseOwner: string
    readonly expectedVersion: number
    readonly checkpoint: Parameters<
      CanonicalGenerationRepository["saveCheckpoint"]
    >[0]["checkpoint"]
  }) {
    assertCanonicalGenerationEnabled(this.policy)
    return db.transaction(async (transaction) => {
      const row = await lockGeneration(transaction, input.generationId)
      if (!row)
        throw new CanonicalGenerationServiceError(
          "not_found",
          "Generation 不存在"
        )
      if (!ACTIVE_STATUSES.includes(row.status as never))
        return { kind: "terminal" as const, version: row.checkpointVersion }
      if (
        row.leaseOwner !== input.leaseOwner ||
        row.checkpointVersion !== input.expectedVersion
      )
        return { kind: "conflict" as const, version: row.checkpointVersion }
      const checkpoint = parseConversationGenerationCheckpoint(input.checkpoint)
      if (!checkpointExtends(row.checkpoint, checkpoint))
        throw new CanonicalGenerationServiceError(
          "checkpoint_conflict",
          "新 checkpoint 不能删除已持久化部分结果"
        )
      const nextVersion = row.checkpointVersion + 1
      await transaction
        .update(conversationMessages)
        .set({
          content: checkpointMessageContent(checkpoint),
          contentState: checkpoint.contentState,
        })
        .where(eq(conversationMessages.id, row.outputMessageId))
      await transaction
        .update(conversationGenerations)
        .set({
          checkpoint,
          checkpointVersion: nextVersion,
          contentState: checkpoint.contentState,
          knownUsage: checkpoint.knownUsage,
          usageCompleteness: inferUsageCompleteness(checkpoint.knownUsage),
          updatedAt: new Date(),
        })
        .where(eq(conversationGenerations.id, row.id))
      return { kind: "saved" as const, version: nextVersion }
    })
  }

  async heartbeat(input: {
    readonly generationId: ReturnType<typeof generationId>
    readonly leaseOwner: string
  }): Promise<boolean> {
    assertCanonicalGenerationEnabled(this.policy)
    const [updated] = await db
      .update(conversationGenerations)
      .set({
        heartbeatAt: new Date(),
        leaseVersion: sql`${conversationGenerations.leaseVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerations.id, input.generationId),
          eq(conversationGenerations.leaseOwner, input.leaseOwner),
          inArray(conversationGenerations.status, ACTIVE_STATUSES)
        )
      )
      .returning({ id: conversationGenerations.id })
    return Boolean(updated)
  }

  async requestStop(input: {
    readonly ownerId: string
    readonly generationId: ReturnType<typeof generationId>
  }): Promise<CanonicalGenerationRecord | null> {
    assertCanonicalGenerationEnabled(this.policy)
    return db.transaction(async (transaction) => {
      const row = await lockGeneration(transaction, input.generationId)
      if (!row || row.ownerId !== input.ownerId) return null
      if (row.status !== "running") return mapGeneration(row)
      const [updated] = await transaction
        .update(conversationGenerations)
        .set({
          status: "stop_requested",
          stopRequestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversationGenerations.id, row.id),
            eq(conversationGenerations.status, "running")
          )
        )
        .returning()
      return mapGeneration(updated ?? row)
    })
  }

  async claimStale(input: {
    readonly generationId: ReturnType<typeof generationId>
    readonly staleBefore: Date
    readonly leaseOwner: string
  }): Promise<CanonicalGenerationRecord | null> {
    assertCanonicalGenerationEnabled(this.policy)
    const [updated] = await db
      .update(conversationGenerations)
      .set({
        leaseOwner: input.leaseOwner,
        leaseVersion: sql`${conversationGenerations.leaseVersion} + 1`,
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationGenerations.id, input.generationId),
          inArray(conversationGenerations.status, ACTIVE_STATUSES),
          lt(conversationGenerations.heartbeatAt, input.staleBefore)
        )
      )
      .returning()
    return updated ? mapGeneration(updated) : null
  }

  async finalizeGeneration(
    input: FinalizeCanonicalGenerationInput
  ): Promise<CanonicalGenerationRecord | null> {
    assertCanonicalGenerationEnabled(this.policy)
    return db.transaction(async (transaction) => {
      const row = await lockGeneration(transaction, input.generationId)
      if (!row) return null
      const checkpoint = parseConversationGenerationCheckpoint(input.checkpoint)

      if (!ACTIVE_STATUSES.includes(row.status as never)) {
        if (
          row.paidCallStarted &&
          row.billingStatus !== "settled" &&
          input.usageCompleteness === "complete" &&
          input.knownUsage
        ) {
          await chargeUsageOnce(transaction, row.id, {
            userId: row.ownerId,
            model: row.modelId,
            inputTokens: input.knownUsage.inputTokens,
            outputTokens: input.knownUsage.outputTokens,
            threadId: row.threadId,
            messageId: row.outputMessageId,
          })
          const [settled] = await transaction
            .update(conversationGenerations)
            .set({
              knownUsage: input.knownUsage,
              usageCompleteness: "complete",
              billingStatus: "settled",
              updatedAt: new Date(),
            })
            .where(eq(conversationGenerations.id, row.id))
            .returning()
          return mapGeneration(settled ?? row)
        }
        return mapGeneration(row)
      }
      if (
        row.leaseOwner !== input.leaseOwner ||
        row.checkpointVersion !== input.expectedCheckpointVersion
      )
        return mapGeneration(row)
      if (!checkpointExtends(row.checkpoint, checkpoint))
        throw new CanonicalGenerationServiceError(
          "checkpoint_conflict",
          "终结 checkpoint 不能覆盖已保存的 partial"
        )

      const outcome =
        !row.isCurrent || row.status === "superseded"
          ? "superseded"
          : row.status === "stop_requested"
            ? "stopped"
            : input.outcome
      const contentState = terminalMessageContentState({ outcome, checkpoint })
      const billingStatus = expectedBillingStatus({
        status: outcome,
        paidCallStarted: row.paidCallStarted,
        usageCompleteness: input.usageCompleteness,
        knownUsage: input.knownUsage,
      })
      if (billingStatus === "settled" && input.knownUsage)
        await chargeUsageOnce(transaction, row.id, {
          userId: row.ownerId,
          model: row.modelId,
          inputTokens: input.knownUsage.inputTokens,
          outputTokens: input.knownUsage.outputTokens,
          threadId: row.threadId,
          messageId: row.outputMessageId,
        })

      const now = new Date()
      await transaction
        .update(conversationMessages)
        .set({
          content: checkpointMessageContent(checkpoint),
          contentState,
        })
        .where(eq(conversationMessages.id, row.outputMessageId))
      if (row.isCurrent && outcome !== "superseded")
        await transaction
          .update(conversationTurns)
          .set({
            activeAssistantMessageId: row.outputMessageId,
            revision: sql`${conversationTurns.revision} + 1`,
            updatedAt: now,
          })
          .where(eq(conversationTurns.id, row.turnId))
      const [updated] = await transaction
        .update(conversationGenerations)
        .set({
          status: outcome,
          contentState,
          checkpoint,
          checkpointVersion: row.checkpointVersion + 1,
          knownUsage: input.knownUsage,
          usageCompleteness: input.usageCompleteness,
          billingStatus,
          leaseOwner: null,
          finishedAt: now,
          errorCode: input.errorCode ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationGenerations.id, row.id),
            inArray(conversationGenerations.status, ACTIVE_STATUSES),
            eq(
              conversationGenerations.checkpointVersion,
              input.expectedCheckpointVersion
            )
          )
        )
        .returning()
      return updated ? mapGeneration(updated) : mapGeneration(row)
    })
  }
}
