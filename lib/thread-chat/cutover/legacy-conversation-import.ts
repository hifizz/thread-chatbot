import type { GenerationResultV1 } from "../contracts/generation-result.ts"
import type { ThreadChatGenerationIntent } from "../contracts/generation-intent.ts"
import {
  conversationId,
  projectId,
  workspaceId,
  type ConversationSnapshot,
  type JsonValue,
} from "../domain/conversation-model.ts"
import type {
  ConversationGenerationCheckpoint,
  KnownGenerationUsage,
} from "../domain/conversation-generation.ts"
import {
  checkpointMessageContent,
  hasRecoverableCheckpointOutput,
} from "../domain/conversation-generation.ts"
import { parseThreadTreeState } from "../domain/message-graph.ts"
import type { MessageFeedback, ThreadTreeState } from "../domain/types.ts"
import { assertValidConversationSnapshot } from "../domain/conversation-validation.ts"
import { auditLegacyConversation } from "../legacy/audit-thread-tree.ts"
import {
  createLegacyIdMap,
  projectLegacyThreadTree,
} from "../legacy/project-thread-tree.ts"

export type LegacyImportEntityType =
  | "conversation"
  | "thread"
  | "fork"
  | "turn"
  | "message"
  | "generation"
  | "artifact"

export interface LegacyImportMapping {
  readonly legacyTreeId: string
  readonly entityType: LegacyImportEntityType
  readonly localId: string
  readonly canonicalId: string
}

export interface LegacyImportGeneration {
  readonly id: string
  readonly userId: string
  readonly threadId: string
  readonly userMessageId: string
  readonly assistantMessageId: string
  readonly attempt: number
  readonly isCurrent: boolean
  readonly status:
    | "running"
    | "stop_requested"
    | "completed"
    | "stopped"
    | "failed"
    | "superseded"
  readonly modelId: string
  readonly intent: ThreadChatGenerationIntent
  readonly result: GenerationResultV1 | null
  readonly billingStatus:
    "pending" | "settled" | "usage_unavailable" | "not_billable"
  readonly heartbeatAt: Date
  readonly stopRequestedAt: Date | null
  readonly finishedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly error: string | null
}

export interface LegacyImportFeedback {
  readonly userId: string
  readonly threadId: string
  readonly messageId: string
  readonly feedback: MessageFeedback
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface LegacyConversationImportPlan {
  readonly legacyTreeId: string
  readonly ownerUserId: string
  readonly snapshot: ConversationSnapshot
  readonly mappings: readonly LegacyImportMapping[]
  readonly artifacts: readonly {
    readonly id: string
    readonly conversationId: string
    readonly sourceThreadId: string
    readonly sourceMessageId: string
    readonly title: string
    readonly kind: string
    readonly lang: string | null
    readonly content: string
  }[]
  readonly generations: readonly {
    readonly id: string
    readonly ownerId: string
    readonly workspaceId: string
    readonly projectId: string
    readonly conversationId: string
    readonly threadId: string
    readonly turnId: string
    readonly inputMessageId: string
    readonly outputMessageId: string
    readonly intent: JsonValue
    readonly requestHash: string
    readonly idempotencyKey: string
    readonly modelId: string
    readonly attempt: number
    readonly isCurrent: boolean
    readonly status: LegacyImportGeneration["status"]
    readonly contentState: string
    readonly checkpointVersion: number
    readonly checkpoint: ConversationGenerationCheckpoint
    readonly knownUsage: KnownGenerationUsage | null
    readonly usageCompleteness: "complete" | "unavailable"
    readonly billingStatus: LegacyImportGeneration["billingStatus"]
    readonly paidCallStarted: boolean
    readonly heartbeatAt: Date
    readonly stopRequestedAt: Date | null
    readonly startedAt: Date
    readonly finishedAt: Date | null
    readonly errorCode: string | null
    readonly createdAt: Date
    readonly updatedAt: Date
  }[]
  readonly feedback: readonly {
    readonly userId: string
    readonly conversationId: string
    readonly threadId: string
    readonly messageId: string
    readonly feedback: MessageFeedback
    readonly createdAt: Date
    readonly updatedAt: Date
  }[]
}

function encoded(value: string): string {
  return encodeURIComponent(value)
}

function canonicalGenerationId(treeId: string, generationId: string): string {
  return `legacy:${encoded(treeId)}:generation:${encoded(generationId)}`
}

function canonicalIntent(
  intent: ThreadChatGenerationIntent,
  message: (localId: string) => string
): JsonValue {
  switch (intent.kind) {
    case "persisted-turn":
      return { kind: "send" }
    case "regenerate-assistant":
      return {
        kind: "regenerate-assistant",
        sourceAssistantMessageId: message(intent.sourceAssistantMessageId),
      }
    case "edit-last-user":
      return {
        kind: "edit-user",
        sourceUserMessageId: message(intent.sourceUserMessageId),
      }
    case "retry-orphan-user":
      return { kind: "retry" }
  }
}

function knownUsage(
  result: GenerationResultV1 | null
): KnownGenerationUsage | null {
  return result?.usage
    ? {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        paidStepCount: 1,
        reportedStepCount: 1,
      }
    : null
}

function checkpoint(
  result: GenerationResultV1 | null,
  mapArtifact: (localId: string) => string,
  usage: KnownGenerationUsage | null
): ConversationGenerationCheckpoint {
  return {
    schemaVersion: 1,
    body: result?.text ?? "",
    artifactIds: (result?.artifactIds ?? []).map(mapArtifact),
    researchPlan: (result?.researchPlan as JsonValue | undefined) ?? null,
    researchActivities: (result?.webResearch ?? []).map((activity) => ({
      id: activity.toolCallId,
      kind: activity.kind,
      status: activity.status,
      sources: activity.sources,
    })),
    contentState:
      result?.status === "done"
        ? "complete"
        : result?.text || result?.artifactIds.length
          ? "incomplete"
          : result?.status === "error"
            ? "failed"
            : "pending",
    knownUsage: usage,
  }
}

/** 只生成确定计划，不写数据库；执行器必须在单 Conversation 事务中消费它。 */
export function buildLegacyConversationImportPlan(input: {
  readonly treeId: string
  readonly ownerUserId: string
  readonly title: string | null
  readonly customTitle: string | null
  readonly state: ThreadTreeState
  readonly generations: readonly LegacyImportGeneration[]
  readonly feedback: readonly LegacyImportFeedback[]
}): LegacyConversationImportPlan {
  const audit = auditLegacyConversation({
    treeId: input.treeId,
    ownerUserId: input.ownerUserId,
    state: input.state,
    generations: input.generations.map((entry) => ({
      id: entry.id,
      threadId: entry.threadId,
      userMessageId: entry.userMessageId,
      assistantMessageId: entry.assistantMessageId,
    })),
    feedback: input.feedback.map((entry) => ({
      threadId: entry.threadId,
      messageId: entry.messageId,
    })),
  })
  if (audit.disposition !== "migratable")
    throw new Error(
      `Legacy tree ${input.treeId} 不可导入：${audit.issues
        .map((entry) => entry.code)
        .join(", ")}`
    )

  const targetWorkspaceId = workspaceId(
    `legacy-workspace:${encoded(input.ownerUserId)}`
  )
  const targetProjectId = projectId(
    `legacy-project:${encoded(input.ownerUserId)}`
  )
  const targetConversationId = conversationId(`legacy:${encoded(input.treeId)}`)
  const ids = createLegacyIdMap({
    legacyTreeId: input.treeId,
    conversationId: targetConversationId,
  })
  const projectedSnapshot = projectLegacyThreadTree({
    legacyTreeId: input.treeId,
    workspaceId: targetWorkspaceId,
    projectId: targetProjectId,
    conversationId: targetConversationId,
    projectTitle: "已导入的 Thread Chat",
    conversationAutoTitle: input.title,
    conversationCustomTitle: input.customTitle,
    actorId: input.ownerUserId,
    state: input.state,
  })
  const state = parseThreadTreeState(input.state)
  const generationArtifacts = input.generations.flatMap((generation) =>
    generation.result ? Object.values(generation.result.artifacts) : []
  )
  const mergedArtifacts = new Map(
    [...Object.values(state.artifacts), ...generationArtifacts].map(
      (artifact) => [artifact.id, artifact]
    )
  )
  const messages = { ...projectedSnapshot.messages }
  for (const generation of input.generations) {
    if (!generation.isCurrent) continue
    const outputId = ids.message(generation.assistantMessageId)
    const current = messages[outputId]
    if (!current)
      throw new Error(`Generation ${generation.id} 的输出 Message 不存在`)
    const usage = knownUsage(generation.result)
    const projectedCheckpoint = checkpoint(
      generation.result,
      ids.artifact,
      usage
    )
    const active =
      generation.status === "running" || generation.status === "stop_requested"
    const contentState = active
      ? generation.result
        ? "streaming"
        : "pending"
      : generation.status === "completed"
        ? "complete"
        : hasRecoverableCheckpointOutput(projectedCheckpoint)
          ? "incomplete"
          : "failed"
    messages[outputId] = {
      ...current,
      content: checkpointMessageContent(projectedCheckpoint),
      contentState,
    }
  }
  const snapshot: ConversationSnapshot = {
    ...projectedSnapshot,
    messages,
    artifactProvenance: Object.fromEntries(
      [...mergedArtifacts.values()].map((artifact) => {
        const id = ids.artifact(artifact.id)
        return [
          id,
          {
            id,
            sourceThreadId: ids.thread(artifact.sourceThreadId),
            sourceMessageId: ids.message(artifact.sourceMessageId),
            title: artifact.title,
            kind: artifact.kind,
          },
        ]
      })
    ),
  }
  assertValidConversationSnapshot(snapshot)

  const mappings: LegacyImportMapping[] = [
    {
      legacyTreeId: input.treeId,
      entityType: "conversation",
      localId: input.treeId,
      canonicalId: targetConversationId,
    },
    ...Object.values(state.threads).map((thread) => ({
      legacyTreeId: input.treeId,
      entityType: "thread" as const,
      localId: thread.id,
      canonicalId: ids.thread(thread.id),
    })),
    ...Object.values(snapshot.turns).map((turn) => ({
      legacyTreeId: input.treeId,
      entityType: "turn" as const,
      localId: `${turn.threadId}:${turn.position}`,
      canonicalId: turn.id,
    })),
    ...Object.values(state.threads).flatMap((thread) =>
      thread.messages.map((message) => ({
        legacyTreeId: input.treeId,
        entityType: "message" as const,
        localId: message.id,
        canonicalId: ids.message(message.id),
      }))
    ),
    ...Object.values(state.threads)
      .filter((thread) => thread.id !== "main")
      .map((thread) => ({
        legacyTreeId: input.treeId,
        entityType: "fork" as const,
        localId: thread.id,
        canonicalId: ids.fork(thread.id),
      })),
    ...[...mergedArtifacts.values()].map((artifact) => ({
      legacyTreeId: input.treeId,
      entityType: "artifact" as const,
      localId: artifact.id,
      canonicalId: ids.artifact(artifact.id),
    })),
    ...input.generations.map((generation) => ({
      legacyTreeId: input.treeId,
      entityType: "generation" as const,
      localId: generation.id,
      canonicalId: canonicalGenerationId(input.treeId, generation.id),
    })),
  ]

  return {
    legacyTreeId: input.treeId,
    ownerUserId: input.ownerUserId,
    snapshot,
    mappings,
    artifacts: [...mergedArtifacts.values()].map((artifact) => ({
      id: ids.artifact(artifact.id),
      conversationId: targetConversationId,
      sourceThreadId: ids.thread(artifact.sourceThreadId),
      sourceMessageId: ids.message(artifact.sourceMessageId),
      title: artifact.title,
      kind: artifact.kind,
      lang: artifact.lang ?? null,
      content: artifact.content,
    })),
    generations: input.generations.map((generation) => {
      const targetInputMessageId = ids.message(generation.userMessageId)
      const targetOutputMessageId = ids.message(generation.assistantMessageId)
      const targetMessage = snapshot.messages[targetInputMessageId]
      const outputMessage = snapshot.messages[targetOutputMessageId]
      if (!targetMessage || !outputMessage)
        throw new Error(`Generation ${generation.id} 的 Message 映射缺失`)
      const usage = knownUsage(generation.result)
      return {
        id: canonicalGenerationId(input.treeId, generation.id),
        ownerId: input.ownerUserId,
        workspaceId: targetWorkspaceId,
        projectId: targetProjectId,
        conversationId: targetConversationId,
        threadId: ids.thread(generation.threadId),
        turnId: targetMessage.turnId,
        inputMessageId: targetInputMessageId,
        outputMessageId: targetOutputMessageId,
        intent: canonicalIntent(generation.intent, ids.message),
        requestHash: `legacy-import:${generation.id}`,
        idempotencyKey: `legacy-import:${input.treeId}:${generation.id}`,
        modelId: generation.modelId,
        attempt: generation.attempt,
        // legacy 的 current 约束按 assistant Message，canonical 按 Turn；只有当前
        // active assistant 对应的 attempt 才能成为该 Turn 的 current Generation。
        isCurrent:
          generation.isCurrent &&
          snapshot.turns[targetMessage.turnId]?.activeAssistantMessageId ===
            targetOutputMessageId,
        status: generation.status,
        contentState: outputMessage.contentState,
        checkpointVersion: generation.result ? 1 : 0,
        checkpoint: checkpoint(generation.result, ids.artifact, usage),
        knownUsage: usage,
        usageCompleteness: usage ? "complete" : "unavailable",
        billingStatus: generation.billingStatus,
        paidCallStarted: generation.billingStatus !== "not_billable",
        heartbeatAt: generation.heartbeatAt,
        stopRequestedAt: generation.stopRequestedAt,
        startedAt: generation.createdAt,
        finishedAt: generation.finishedAt,
        errorCode: generation.error,
        createdAt: generation.createdAt,
        updatedAt: generation.updatedAt,
      }
    }),
    feedback: input.feedback.map((entry) => ({
      userId: entry.userId,
      conversationId: targetConversationId,
      threadId: ids.thread(entry.threadId),
      messageId: ids.message(entry.messageId),
      feedback: entry.feedback,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
  }
}
