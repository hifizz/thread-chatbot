import { ZodError, type ZodType } from "zod"
import type {
  ApiErrorCode,
  CommandResponse,
} from "@/lib/thread-chat/contracts/errors"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"
import { CommandIdConflictError } from "@/lib/thread-chat/persistence/command-repository"
import { ensureThreadChatRuntimeInitialized } from "@/lib/thread-chat/streaming/runtime"
import {
  requireThreadChatUser,
  ThreadChatUnauthorizedError,
} from "@/lib/thread-chat/server/auth"

const JSON_NO_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
} as const

export type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>
}

export function jsonNoCache(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers)
  for (const [name, value] of Object.entries(JSON_NO_CACHE_HEADERS))
    headers.set(name, value)
  return Response.json(data, { ...init, headers })
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>
): Promise<T> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new ZodError([
      { code: "custom", path: [], message: "请求体必须是合法 JSON" },
    ])
  }
  return schema.parse(value)
}

export function commandResponse<T>(input: {
  replayed: boolean
  result: T
}): Response {
  const body: CommandResponse<T> = {
    ok: true,
    replayed: input.replayed,
    data: input.result,
  }
  return jsonNoCache(body)
}

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>
): Response {
  return jsonNoCache(
    {
      ok: false,
      error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) },
    },
    { status }
  )
}

export function mapRouteError(error: unknown): Response {
  if (error instanceof ThreadChatUnauthorizedError)
    return errorResponse(401, "NOT_FOUND", error.message)
  if (error instanceof ZodError) {
    const flattened = error.flatten()
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "请求参数不合法",
      flattened.fieldErrors as Record<string, string[]>
    )
  }
  if (error instanceof CommandIdConflictError)
    return errorResponse(409, error.code, error.message)
  if (error instanceof ConversationApplicationError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "VALIDATION_ERROR" ||
            error.code === "MODEL_NOT_ALLOWED"
          ? 400
          : 409
    return errorResponse(status, error.code, error.message)
  }
  if (error instanceof Error && error.message === "SESSION_NOT_AVAILABLE")
    return errorResponse(
      409,
      "SESSION_NOT_AVAILABLE",
      "生成流已不可用，请轮询消息状态"
    )
  console.error("[thread-chat:v1] route failed", error)
  return errorResponse(500, "GENERATION_FAILED", "服务暂时不可用")
}

export async function withThreadChatRoute(
  request: Request,
  execute: (userId: string) => Promise<Response>
): Promise<Response> {
  try {
    await ensureThreadChatRuntimeInitialized()
    const userId = await requireThreadChatUser(request.headers)
    return await execute(userId)
  } catch (error) {
    return mapRouteError(error)
  }
}
