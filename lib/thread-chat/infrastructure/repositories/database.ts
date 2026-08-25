import type postgres from "postgres"
import type { Artifact } from "../../domain/artifact"
import type { Message } from "../../domain/message"
import type { MessageRun } from "../../domain/message-run"
import type { Project } from "../../domain/project"
import type { Thread } from "../../domain/thread"

export type ThreadChatSql = postgres.Sql | postgres.TransactionSql

export function toSqlJsonText(value: unknown): string {
  return JSON.stringify(value)
}

export function toSqlTimestamp(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function toNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value)
}

function fromSqlJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    ownerUserId: String(row.ownerUserId),
    autoTitle: (row.autoTitle as string | null) ?? null,
    customTitle: (row.customTitle as string | null) ?? null,
    target: (row.target as Project["target"]) ?? null,
    instruction: (row.instruction as string | null) ?? null,
    archivedAt: toNullableDate(row.archivedAt),
    artifactChangeSequence: Number(row.artifactChangeSequence),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  }
}

export function mapThread(row: Record<string, unknown>): Thread {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    parentThreadId: (row.parentThreadId as string | null) ?? null,
    sourceMessageId: (row.sourceMessageId as string | null) ?? null,
    forkSourceSnapshot:
      (fromSqlJson(row.forkSourceSnapshot) as Thread["forkSourceSnapshot"]) ??
      null,
    baseContext:
      (fromSqlJson(row.baseContext) as Thread["baseContext"]) ?? null,
    autoTitle: (row.autoTitle as string | null) ?? null,
    customTitle: (row.customTitle as string | null) ?? null,
    archivedAt: toNullableDate(row.archivedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  }
}

export function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    threadId: String(row.threadId),
    sequence: Number(row.sequence),
    role: row.role as Message["role"],
    parts: (fromSqlJson(row.parts) as Message["parts"]) ?? null,
    replacesMessageId: (row.replacesMessageId as string | null) ?? null,
    supersededAt: toNullableDate(row.supersededAt),
    finalizedAt: toNullableDate(row.finalizedAt),
    createdAt: toDate(row.createdAt),
  }
}

export function mapMessageRun(row: Record<string, unknown>): MessageRun {
  return {
    id: String(row.id),
    assistantMessageId: String(row.assistantMessageId),
    status: row.status as MessageRun["status"],
    modelId: String(row.modelId),
    eventSequence: Number(row.eventSequence),
    checkpointParts: fromSqlJson(
      row.checkpointParts
    ) as MessageRun["checkpointParts"],
    errorCode: (row.errorCode as string | null) ?? null,
    errorMessage: (row.errorMessage as string | null) ?? null,
    heartbeatAt: toNullableDate(row.heartbeatAt),
    stopRequestedAt: toNullableDate(row.stopRequestedAt),
    finishedAt: toNullableDate(row.finishedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
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
    content: fromSqlJson(row.content),
    createdAt: toDate(row.createdAt),
  }
}
