import { handleUnauthorized } from "@/lib/auth/session-recovery"
import { messageActionFailureResponseSchema } from "@/lib/thread-chat/contracts/message-action-failure"
import type { GenerationActionResult } from "../chat/message-action-commands"

type ChatGenerationCommandInput = {
  body: unknown
  signal: AbortSignal
}

type ChatGenerationCommandDependencies = {
  fetch: typeof globalThis.fetch
  unauthorized(): void | Promise<void>
}

const defaultDependencies: ChatGenerationCommandDependencies = {
  fetch: (input, init) => globalThis.fetch(input, init),
  unauthorized: handleUnauthorized,
}

export type ChatGenerationCommandResult =
  | { kind: "replayed" }
  | { kind: "stream"; response: Response; revision: number | null }
  | {
      kind: "rejected"
      failure: Extract<GenerationActionResult, { ok: false }>
    }

/** POST /api/chat，并把 HTTP 层结果归一为 replay、stream 或 rejected。 */
export async function requestChatGeneration(
  { body, signal }: ChatGenerationCommandInput,
  dependencies: ChatGenerationCommandDependencies = defaultDependencies
): Promise<ChatGenerationCommandResult> {
  const res = await dependencies.fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })

  if (res.status === 202) return { kind: "replayed" }
  if (!res.ok || !res.body) {
    if (res.status === 401) void dependencies.unauthorized()
    const payload = await res.json().catch(() => null)
    const structured = messageActionFailureResponseSchema.safeParse(payload)
    const stringMessage =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as Record<string, unknown>).error === "string"
        ? ((payload as Record<string, unknown>).error as string)
        : null
    const message =
      res.status === 401
        ? "登录已失效，正在跳转登录…"
        : structured.success
          ? structured.data.error.message
          : (stringMessage ?? `请求失败（HTTP ${res.status}）`)
    return {
      kind: "rejected",
      failure: {
        ok: false,
        code:
          res.status === 401
            ? "unauthorized"
            : structured.success
              ? structured.data.error.code
              : "network_error",
        message,
      },
    }
  }

  const revision = Number(res.headers.get("x-thread-tree-revision"))
  return {
    kind: "stream",
    response: res,
    revision: Number.isInteger(revision) ? revision : null,
  }
}
