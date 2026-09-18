import { createHmac } from "node:crypto"
import { createTraceId } from "@langfuse/tracing"

function requireIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} must not be empty`)
  return normalized
}

/**
 * Trace 映射版本：v1 是历史 message-scope 计算（不落库），
 * v2 是 generation-scope 确定性 ID，随 Generation（assistant Message 行）保存。
 */
export const TRACE_MAPPING_VERSIONS = {
  messageScopeV1: 1,
  generationScopeV2: 2,
} as const

export async function assistantMessageTraceId(
  assistantMessageId: string
): Promise<string> {
  return createTraceId(
    `thread-chat:${requireIdentifier(assistantMessageId, "assistantMessageId")}`
  )
}

/** v2：同一 Generation 输入恒定得到同一 Trace ID；与 v1 命名空间隔离。 */
export async function generationTraceId(generationId: string): Promise<string> {
  return createTraceId(
    `thread-chat:generation:v2:${requireIdentifier(generationId, "generationId")}`
  )
}

export async function generationTraceMapping(generationId: string): Promise<{
  traceId: string
  traceMappingVersion: number
}> {
  return {
    traceId: await generationTraceId(generationId),
    traceMappingVersion: TRACE_MAPPING_VERSIONS.generationScopeV2,
  }
}

/**
 * 回读保存的映射；历史行（无列或 v1）回落到 message-scope 计算，
 * 保证旧反馈/outbox 重试仍关联原 Trace。
 */
export async function resolveMessageTraceId(row: {
  id: string
  traceId?: string | null
  traceMappingVersion?: number | null
}): Promise<{ traceId: string; traceMappingVersion: number }> {
  if (
    row.traceMappingVersion === TRACE_MAPPING_VERSIONS.generationScopeV2 &&
    typeof row.traceId === "string" &&
    row.traceId
  ) {
    return {
      traceId: row.traceId,
      traceMappingVersion: TRACE_MAPPING_VERSIONS.generationScopeV2,
    }
  }
  return {
    traceId: await assistantMessageTraceId(row.id),
    traceMappingVersion: TRACE_MAPPING_VERSIONS.messageScopeV1,
  }
}

export async function requestTraceId(requestId: string): Promise<string> {
  return createTraceId(
    `legacy-chat:${requireIdentifier(requestId, "requestId")}`
  )
}

export async function feedbackScoreId(messageId: string): Promise<string> {
  return createTraceId(
    `user-feedback:${requireIdentifier(messageId, "messageId")}`
  )
}

export function pseudonymizeUserId(userId: string, salt: string): string {
  const normalizedUserId = requireIdentifier(userId, "userId")
  const normalizedSalt = requireIdentifier(salt, "salt")
  return `usr_${createHmac("sha256", normalizedSalt)
    .update(normalizedUserId)
    .digest("hex")}`
}
