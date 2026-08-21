import { GenerationRepositoryError } from "@/lib/thread-chat-generation/start-generation-repository"
import type { MessageActionFailureResponse } from "@/lib/thread-chat/contracts/message-action-failure"

/** 将 generation start 事务错误映射为稳定的 HTTP 响应。 */
export function generationStartErrorResponse(error: unknown): Response {
  if (error instanceof GenerationRepositoryError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      } satisfies MessageActionFailureResponse,
      {
        status:
          error.code === "not_found"
            ? 404
            : error.code === "persistence_failed"
              ? 503
              : 409,
      }
    )
  }
  console.error("[thread-chat-generation] start transaction 失败", error)
  return Response.json(
    {
      error: {
        code: "persistence_failed",
        message: "无法建立生成任务，尚未调用模型",
      },
    } satisfies MessageActionFailureResponse,
    { status: 503 }
  )
}
