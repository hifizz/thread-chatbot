import { getCurrentUserId } from "@/lib/auth/server"
import type { ApiErrorCode } from "../contracts"
import { errorResponse, ThreadChatApiError } from "./errors"

export const jsonData = (data: unknown, status = 200) =>
  Response.json({ data }, { status })

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ThreadChatApiError(
      "validation_error",
      400,
      "Request body must be valid JSON."
    )
  }
}

export async function withActor(
  action: (actorId: string) => Promise<Response>,
  fallbackNotFound: ApiErrorCode = "internal_error",
  resolveActor: () => Promise<string | null> = getCurrentUserId
): Promise<Response> {
  try {
    const actorId = await resolveActor()
    if (!actorId)
      throw new ThreadChatApiError(
        "unauthorized",
        401,
        "Authentication required."
      )
    return await action(actorId)
  } catch (error) {
    return errorResponse(error, fallbackNotFound)
  }
}
