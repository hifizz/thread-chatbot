import { randomUUID } from "node:crypto"

import type { z } from "zod"

import {
  CONVERSATION_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH,
  CONVERSATION_COMMAND_SCHEMA_VERSION,
} from "../../../constants/conversation-command"
import { getCurrentUserId } from "../../auth/server"
import {
  ConversationCommandError,
  type CommandSuccess,
  type CommandEnvelope,
  type CommandScope,
} from "../application/conversation-command-contracts"
import { CanonicalGenerationServiceError } from "../application/conversation-generation-service"
import { InvalidEntityIdError } from "../domain/conversation-model"
import { resolveConversationAuthority } from "../cutover/conversation-authority"

const ERROR_STATUS: Record<string, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  version_conflict: 409,
  idempotency_conflict: 409,
  state_conflict: 409,
  conversation_action_required: 409,
  fork_required: 422,
  semantic_validation: 422,
  rate_limited: 429,
  maintenance: 503,
  internal: 500,
}

export async function authenticatedActor() {
  const userId = await getCurrentUserId()
  if (!userId) throw new ConversationCommandError("unauthenticated", "请先登录")
  return { kind: "user" as const, userId }
}

export async function parseJson<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema
): Promise<z.output<TSchema>> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new ConversationCommandError("invalid_request", "body 必须是 JSON")
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    throw new ConversationCommandError(
      "invalid_request",
      "请求载荷不符合 schema",
      {
        reason: parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      }
    )
  return parsed.data
}

export function assertCanonicalMutationAllowed(): void {
  if (resolveConversationAuthority().maintenanceMode === "read-only")
    throw new ConversationCommandError(
      "maintenance",
      "Conversation 正处于受控维护窗口，请稍后重试",
      { retryable: true }
    )
}

export function commandEnvelope<TPayload>(input: {
  readonly request: Request
  readonly actor: { readonly kind: "user"; readonly userId: string }
  readonly scope: CommandScope
  readonly payload: TPayload
  readonly expectedRevisionRequired?: boolean
}): CommandEnvelope<TPayload> {
  assertCanonicalMutationAllowed()
  const idempotencyKey = input.request.headers.get("Idempotency-Key")?.trim()
  if (
    !idempotencyKey ||
    idempotencyKey.length > CONVERSATION_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH
  )
    throw new ConversationCommandError(
      "invalid_request",
      `Idempotency-Key 必须为 1–${CONVERSATION_COMMAND_IDEMPOTENCY_KEY_MAX_LENGTH} 字符`,
      { field: "Idempotency-Key" }
    )
  const expectedRevision = parseIfMatch(input.request.headers.get("If-Match"))
  if (input.expectedRevisionRequired && expectedRevision === undefined)
    throw new ConversationCommandError(
      "invalid_request",
      "该命令必须提供 If-Match revision",
      { field: "If-Match" }
    )
  return {
    commandId:
      input.request.headers.get("X-Command-Id")?.trim() || randomUUID(),
    actor: input.actor,
    scope: input.scope,
    idempotencyKey,
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    payload: input.payload,
  }
}

function parseIfMatch(value: string | null): number | undefined {
  if (!value) return undefined
  const normalized = value.trim().replace(/^W\//, "").replace(/^"|"$/g, "")
  if (!/^\d+$/.test(normalized))
    throw new ConversationCommandError(
      "invalid_request",
      "If-Match 必须是非负整数 revision",
      {
        field: "If-Match",
      }
    )
  return Number(normalized)
}

export function commandResponse(
  result: CommandSuccess,
  revisionScopeId: string
): Response {
  const revision = result.revisions[revisionScopeId]
  return Response.json(result, {
    headers: revision === undefined ? undefined : { ETag: `"${revision}"` },
  })
}

export function queryResponse(data: unknown, revision?: number): Response {
  return Response.json(
    { schemaVersion: CONVERSATION_COMMAND_SCHEMA_VERSION, data },
    { headers: revision === undefined ? undefined : { ETag: `"${revision}"` } }
  )
}

export function routeErrorResponse(error: unknown): Response {
  const requestId = randomUUID()
  let normalized: ConversationCommandError
  if (error instanceof ConversationCommandError) normalized = error
  else if (error instanceof CanonicalGenerationServiceError)
    normalized = new ConversationCommandError(
      error.code === "not_found"
        ? "not_found"
        : error.code.includes("conflict")
          ? "state_conflict"
          : "internal",
      error.code === "not_found" ? "资源不存在" : "Generation 命令失败"
    )
  else if (error instanceof InvalidEntityIdError)
    normalized = new ConversationCommandError("invalid_request", error.message)
  else {
    console.error("[conversation-command-api] 未处理错误", { requestId, error })
    normalized = new ConversationCommandError("internal", "服务器内部错误")
  }
  return Response.json(
    {
      error: {
        code: normalized.code,
        message: normalized.message,
        requestId,
        ...(Object.keys(normalized.details).length > 0
          ? { details: normalized.details }
          : {}),
      },
    },
    { status: ERROR_STATUS[normalized.code] ?? 500 }
  )
}

export async function withConversationRoute(
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    return routeErrorResponse(error)
  }
}
