import { createHmac } from "node:crypto"
import { createTraceId } from "@langfuse/tracing"

function requireIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} must not be empty`)
  return normalized
}

export async function assistantMessageTraceId(
  assistantMessageId: string
): Promise<string> {
  return createTraceId(
    `thread-chat:${requireIdentifier(assistantMessageId, "assistantMessageId")}`
  )
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
