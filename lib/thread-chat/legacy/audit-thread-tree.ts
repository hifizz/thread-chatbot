import {
  conversationId,
  projectId,
  workspaceId,
} from "../domain/conversation-model.ts"
import type { ThreadTreeState } from "../domain/types.ts"
import { projectLegacyThreadTree } from "./project-thread-tree.ts"

export type LegacyConversationAuditCode =
  | "owner_missing"
  | "state_not_object"
  | "threads_not_object"
  | "root_thread_missing"
  | "duplicate_message_id"
  | "message_parent_missing"
  | "active_leaf_missing"
  | "fork_parent_missing"
  | "fork_source_missing"
  | "fork_backlink_missing"
  | "fork_backlink_duplicate"
  | "artifact_source_thread_missing"
  | "artifact_source_message_missing"
  | "generation_thread_missing"
  | "generation_user_message_missing"
  | "generation_assistant_message_missing"
  | "feedback_thread_missing"
  | "feedback_message_missing"
  | "canonical_projection_failed"

export interface LegacyConversationAuditIssue {
  readonly code: LegacyConversationAuditCode
  readonly path: string
  readonly entityId?: string
}

export interface LegacyGenerationReference {
  readonly id: string
  readonly threadId: string
  readonly userMessageId: string
  readonly assistantMessageId: string
}

export interface LegacyFeedbackReference {
  readonly threadId: string
  readonly messageId: string
}

export interface LegacyEntityMapping {
  readonly legacyId: string
  readonly canonicalId: string
}

export interface LegacyConversationAuditReport {
  readonly treeId: string
  readonly owner: "owned" | "unowned"
  readonly disposition: "migratable" | "needs_repair" | "rejected"
  readonly issues: readonly LegacyConversationAuditIssue[]
  readonly counts: {
    readonly threads: number
    readonly forks: number
    readonly turns: number
    readonly messages: number
    readonly artifacts: number
    readonly generations: number
    readonly feedback: number
  }
  readonly mappings: {
    readonly conversation: LegacyEntityMapping
    readonly threads: readonly LegacyEntityMapping[]
    readonly messages: readonly LegacyEntityMapping[]
  }
}

export interface AuditLegacyConversationInput {
  readonly treeId: string
  readonly ownerUserId: string | null
  readonly state: unknown
  readonly generations: readonly LegacyGenerationReference[]
  readonly feedback: readonly LegacyFeedbackReference[]
}

interface LegacyMessageShape {
  readonly id?: unknown
  readonly parentMessageId?: unknown
  readonly forks?: unknown
}

interface LegacyThreadShape {
  readonly id?: unknown
  readonly parentId?: unknown
  readonly forkFromMsgId?: unknown
  readonly activeLeafMessageId?: unknown
  readonly messages?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function issue(
  issues: LegacyConversationAuditIssue[],
  code: LegacyConversationAuditCode,
  path: string,
  entityId?: string
): void {
  issues.push({ code, path, ...(entityId ? { entityId } : {}) })
}

function sortedMappings(
  values: readonly LegacyEntityMapping[]
): readonly LegacyEntityMapping[] {
  return [...values].sort((left, right) =>
    left.legacyId.localeCompare(right.legacyId)
  )
}

function emptyReport(
  input: AuditLegacyConversationInput,
  issues: readonly LegacyConversationAuditIssue[]
): LegacyConversationAuditReport {
  const canonicalConversationId = `legacy:${encodeURIComponent(input.treeId)}`
  return {
    treeId: input.treeId,
    owner: input.ownerUserId ? "owned" : "unowned",
    disposition: "rejected",
    issues,
    counts: {
      threads: 0,
      forks: 0,
      turns: 0,
      messages: 0,
      artifacts: 0,
      generations: input.generations.length,
      feedback: input.feedback.length,
    },
    mappings: {
      conversation: {
        legacyId: input.treeId,
        canonicalId: canonicalConversationId,
      },
      threads: [],
      messages: [],
    },
  }
}

export function auditLegacyConversation(
  input: AuditLegacyConversationInput
): LegacyConversationAuditReport {
  const issues: LegacyConversationAuditIssue[] = []
  if (!input.ownerUserId) issue(issues, "owner_missing", "userId", input.treeId)
  if (!isRecord(input.state)) {
    issue(issues, "state_not_object", "state", input.treeId)
    return emptyReport(input, issues)
  }
  if (!isRecord(input.state.threads)) {
    issue(issues, "threads_not_object", "state.threads", input.treeId)
    return emptyReport(input, issues)
  }

  const rawThreads = input.state.threads
  if (!isRecord(rawThreads.main))
    issue(issues, "root_thread_missing", "state.threads.main", "main")

  const messageLocations = new Map<string, string>()
  const messagesByThread = new Map<string, Set<string>>()
  let forkCount = 0

  for (const [threadKey, rawThread] of Object.entries(rawThreads)) {
    if (!isRecord(rawThread)) continue
    const rawMessages = Array.isArray(rawThread.messages)
      ? rawThread.messages
      : []
    const localMessageIds = new Set<string>()
    messagesByThread.set(threadKey, localMessageIds)
    for (const [messageIndex, rawMessage] of rawMessages.entries()) {
      if (!isRecord(rawMessage) || typeof rawMessage.id !== "string") continue
      if (messageLocations.has(rawMessage.id))
        issue(
          issues,
          "duplicate_message_id",
          `state.threads.${threadKey}.messages.${messageIndex}`,
          rawMessage.id
        )
      else messageLocations.set(rawMessage.id, threadKey)
      localMessageIds.add(rawMessage.id)
    }
  }

  for (const [threadKey, rawThread] of Object.entries(rawThreads)) {
    if (!isRecord(rawThread)) continue
    const thread = rawThread as LegacyThreadShape
    const rawMessages = Array.isArray(thread.messages) ? thread.messages : []
    const localMessageIds = messagesByThread.get(threadKey) ?? new Set()

    for (const [messageIndex, rawMessage] of rawMessages.entries()) {
      if (!isRecord(rawMessage) || typeof rawMessage.id !== "string") continue
      const message: LegacyMessageShape = rawMessage
      if (
        typeof message.parentMessageId === "string" &&
        !localMessageIds.has(message.parentMessageId)
      )
        issue(
          issues,
          "message_parent_missing",
          `state.threads.${threadKey}.messages.${messageIndex}.parentMessageId`,
          message.parentMessageId
        )
      if (Array.isArray(message.forks)) forkCount += message.forks.length
    }

    if (
      typeof thread.activeLeafMessageId === "string" &&
      !localMessageIds.has(thread.activeLeafMessageId)
    )
      issue(
        issues,
        "active_leaf_missing",
        `state.threads.${threadKey}.activeLeafMessageId`,
        thread.activeLeafMessageId
      )

    if (threadKey !== "main") {
      if (
        typeof thread.parentId !== "string" ||
        !isRecord(rawThreads[thread.parentId])
      )
        issue(
          issues,
          "fork_parent_missing",
          `state.threads.${threadKey}.parentId`,
          typeof thread.parentId === "string" ? thread.parentId : threadKey
        )
      const parentMessages =
        typeof thread.parentId === "string"
          ? messagesByThread.get(thread.parentId)
          : undefined
      if (
        typeof thread.forkFromMsgId !== "string" ||
        !parentMessages?.has(thread.forkFromMsgId)
      )
        issue(
          issues,
          "fork_source_missing",
          `state.threads.${threadKey}.forkFromMsgId`,
          typeof thread.forkFromMsgId === "string"
            ? thread.forkFromMsgId
            : threadKey
        )
      else {
        const parent = rawThreads[thread.parentId as string]
        const parentMessage = isRecord(parent)
          ? (Array.isArray(parent.messages) ? parent.messages : []).find(
              (candidate) =>
                isRecord(candidate) && candidate.id === thread.forkFromMsgId
            )
          : undefined
        const matchingBacklinks =
          isRecord(parentMessage) && Array.isArray(parentMessage.forks)
            ? parentMessage.forks.filter(
                (candidate) =>
                  isRecord(candidate) && candidate.threadId === threadKey
              ).length
            : 0
        if (matchingBacklinks === 0)
          issue(
            issues,
            "fork_backlink_missing",
            `state.threads.${threadKey}`,
            threadKey
          )
        if (matchingBacklinks > 1)
          issue(
            issues,
            "fork_backlink_duplicate",
            `state.threads.${threadKey}`,
            threadKey
          )
      }
    }
  }

  const rawArtifacts = isRecord(input.state.artifacts)
    ? input.state.artifacts
    : {}
  for (const [artifactKey, rawArtifact] of Object.entries(rawArtifacts)) {
    if (!isRecord(rawArtifact)) continue
    if (
      typeof rawArtifact.sourceThreadId !== "string" ||
      !messagesByThread.has(rawArtifact.sourceThreadId)
    )
      issue(
        issues,
        "artifact_source_thread_missing",
        `state.artifacts.${artifactKey}.sourceThreadId`,
        artifactKey
      )
    else if (
      typeof rawArtifact.sourceMessageId !== "string" ||
      !messagesByThread
        .get(rawArtifact.sourceThreadId)
        ?.has(rawArtifact.sourceMessageId)
    )
      issue(
        issues,
        "artifact_source_message_missing",
        `state.artifacts.${artifactKey}.sourceMessageId`,
        artifactKey
      )
  }

  for (const generation of input.generations) {
    const threadMessages = messagesByThread.get(generation.threadId)
    if (!threadMessages)
      issue(
        issues,
        "generation_thread_missing",
        `generations.${generation.id}.threadId`,
        generation.threadId
      )
    else {
      if (!threadMessages.has(generation.userMessageId))
        issue(
          issues,
          "generation_user_message_missing",
          `generations.${generation.id}.userMessageId`,
          generation.userMessageId
        )
      if (!threadMessages.has(generation.assistantMessageId))
        issue(
          issues,
          "generation_assistant_message_missing",
          `generations.${generation.id}.assistantMessageId`,
          generation.assistantMessageId
        )
    }
  }

  for (const [feedbackIndex, feedback] of input.feedback.entries()) {
    const threadMessages = messagesByThread.get(feedback.threadId)
    if (!threadMessages)
      issue(
        issues,
        "feedback_thread_missing",
        `feedback.${feedbackIndex}.threadId`,
        feedback.threadId
      )
    else if (!threadMessages.has(feedback.messageId))
      issue(
        issues,
        "feedback_message_missing",
        `feedback.${feedbackIndex}.messageId`,
        feedback.messageId
      )
  }

  const canonicalConversationId = conversationId(
    `legacy:${encodeURIComponent(input.treeId)}`
  )
  let snapshot: ReturnType<typeof projectLegacyThreadTree> | null = null
  try {
    snapshot = projectLegacyThreadTree({
      legacyTreeId: input.treeId,
      workspaceId: workspaceId(
        `legacy-workspace:${encodeURIComponent(input.ownerUserId ?? "unowned")}`
      ),
      projectId: projectId(
        `legacy-project:${encodeURIComponent(input.treeId)}`
      ),
      conversationId: canonicalConversationId,
      projectTitle: "遗留数据审计",
      conversationAutoTitle: null,
      conversationCustomTitle: null,
      actorId: input.ownerUserId ?? "legacy-unowned",
      state: input.state as unknown as ThreadTreeState,
    })
  } catch {
    issue(issues, "canonical_projection_failed", "state", input.treeId)
  }

  const threadMappings = snapshot
    ? Object.keys(rawThreads).flatMap((legacyId) => {
        const suffix = `:thread:${legacyId === "main" ? "root" : encodeURIComponent(legacyId)}`
        const canonical = Object.keys(snapshot.threads).find((id) =>
          id.endsWith(suffix)
        )
        return canonical ? [{ legacyId, canonicalId: canonical }] : []
      })
    : []
  const messageMappings = snapshot
    ? [...messageLocations.keys()].flatMap((legacyId) => {
        const suffix = `:message:${encodeURIComponent(legacyId)}`
        const canonical = Object.keys(snapshot.messages).find((id) =>
          id.endsWith(suffix)
        )
        return canonical ? [{ legacyId, canonicalId: canonical }] : []
      })
    : []
  const hardRejection = issues.some(
    (entry) =>
      entry.code !== "owner_missing" &&
      entry.code !== "generation_user_message_missing" &&
      entry.code !== "generation_assistant_message_missing" &&
      entry.code !== "feedback_message_missing"
  )

  return {
    treeId: input.treeId,
    owner: input.ownerUserId ? "owned" : "unowned",
    disposition: hardRejection
      ? "rejected"
      : issues.length > 0
        ? "needs_repair"
        : "migratable",
    issues: [...issues].sort((left, right) =>
      `${left.code}:${left.path}`.localeCompare(`${right.code}:${right.path}`)
    ),
    counts: {
      threads: Object.keys(rawThreads).length,
      forks: forkCount,
      turns: snapshot ? Object.keys(snapshot.turns).length : 0,
      messages: messageLocations.size,
      artifacts: Object.keys(rawArtifacts).length,
      generations: input.generations.length,
      feedback: input.feedback.length,
    },
    mappings: {
      conversation: {
        legacyId: input.treeId,
        canonicalId: canonicalConversationId,
      },
      threads: sortedMappings(threadMappings),
      messages: sortedMappings(messageMappings),
    },
  }
}
