import { ZodError } from "zod"
import { SHARE_HEADERS, SHARE_LIMITS } from "@/constants/sharing"
import { requireThreadChatUser, ThreadChatUnauthorizedError } from "./auth"
import { CommandIdConflictError } from "../persistence/command-repository"
import { ConversationApplicationError } from "../application/errors"

export function shareJson(data: unknown, status = 200) { return Response.json(data, { status, headers: SHARE_HEADERS }) }
export async function readShareRequest(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new SyntaxError()
  let size = 0, body = ""
  const decoder = new TextDecoder()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > SHARE_LIMITS.requestBytes) throw new Error("SHARE_TOO_LARGE")
      body += decoder.decode(chunk.value, { stream: true })
    }
    return JSON.parse(body + decoder.decode()) as unknown
  } finally { await reader.cancel() }
}
export async function withShareOwner(request: Request, execute: (userId: string) => Promise<Response>) {
  try {
    const userId = await requireThreadChatUser(request.headers)
    const origin = request.headers.get("origin")
    if (request.method !== "GET" && origin && origin !== new URL(request.url).origin) return shareJson({ error: "请求来源不合法" }, 403)
    return await execute(userId)
  } catch (error) {
    if (error instanceof ThreadChatUnauthorizedError) return shareJson({ error: "请先登录" }, 401)
    if (error instanceof ZodError || error instanceof SyntaxError) return shareJson({ error: "分享参数不合法" }, 400)
    if (error instanceof CommandIdConflictError) return shareJson({ error: error.message }, 409)
    if (error instanceof ConversationApplicationError) return shareJson({ error: "资源不存在" }, 404)
    if (error instanceof Error && error.message === "SHARE_TOO_LARGE") return shareJson({ error: "内容或布局超过分享上限，请单独分享 Markdown 文档" }, 413)
    if (error instanceof Error && error.message === "SHARE_INVALID_SOURCE") return shareJson({ error: "来源尚未完成或阅读关联不完整，无法创建分享" }, 409)
    // 数据库错误可能带 SQL 参数（包含正文/token）；不输出原始异常。
    return shareJson({ error: "分享暂时不可用，请重试" }, 503)
  }
}
