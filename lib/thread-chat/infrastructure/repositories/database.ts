import type postgres from "postgres"
import type { Artifact } from "../../domain/artifact"
import type { Message } from "../../domain/message"
import type { MessageRun } from "../../domain/message-run"
import type { Project } from "../../domain/project"
import type { Thread } from "../../domain/thread"

export type ThreadChatSql = postgres.Sql | postgres.TransactionSql

export function toSqlJson(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue
}

export function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    ownerUserId: String(row.ownerUserId),
    autoTitle: (row.autoTitle as string | null) ?? null,
    customTitle: (row.customTitle as string | null) ?? null,
    target: (row.target as Project["target"]) ?? null,
    instruction: (row.instruction as string | null) ?? null,
    archivedAt: (row.archivedAt as Date | null) ?? null,
    artifactChangeSequence: Number(row.artifactChangeSequence),
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }
}

export function mapThread(row: Record<string, unknown>): Thread {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    parentThreadId: (row.parentThreadId as string | null) ?? null,
    sourceMessageId: (row.sourceMessageId as string | null) ?? null,
    forkSourceSnapshot:
      (row.forkSourceSnapshot as Thread["forkSourceSnapshot"]) ?? null,
    baseContext: (row.baseContext as Thread["baseContext"]) ?? null,
    autoTitle: (row.autoTitle as string | null) ?? null,
    customTitle: (row.customTitle as string | null) ?? null,
    archivedAt: (row.archivedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }
}

export function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    threadId: String(row.threadId),
    sequence: Number(row.sequence),
    role: row.role as Message["role"],
    parts: (row.parts as Message["parts"]) ?? null,
    replacesMessageId: (row.replacesMessageId as string | null) ?? null,
    supersededAt: (row.supersededAt as Date | null) ?? null,
    finalizedAt: (row.finalizedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
  }
}

export function mapMessageRun(row: Record<string, unknown>): MessageRun {
  return {
    id: String(row.id),
    assistantMessageId: String(row.assistantMessageId),
    status: row.status as MessageRun["status"],
    modelId: String(row.modelId),
    eventSequence: Number(row.eventSequence),
    checkpointParts: row.checkpointParts as MessageRun["checkpointParts"],
    errorCode: (row.errorCode as string | null) ?? null,
    errorMessage: (row.errorMessage as string | null) ?? null,
    heartbeatAt: (row.heartbeatAt as Date | null) ?? null,
    stopRequestedAt: (row.stopRequestedAt as Date | null) ?? null,
    finishedAt: (row.finishedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }
}

export function mapArtifact(row: Record<string, unknown>): Artifact {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    sourceMessageId: String(row.sourceMessageId),
    changeSequence: Number(row.changeSequence),
    kind: String(row.kind),
    title: String(row.title),
    content: row.content,
    createdAt: row.createdAt as Date,
  }
}
