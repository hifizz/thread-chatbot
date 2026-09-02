import { getCurrentUserId } from "@/lib/auth/server"

export async function requireThreadChatUser(
  requestHeaders: Headers
): Promise<string> {
  const userId = await getCurrentUserId(requestHeaders)
  if (!userId) throw new ThreadChatUnauthorizedError()
  return userId
}

export class ThreadChatUnauthorizedError extends Error {
  constructor() {
    super("未登录")
    this.name = "ThreadChatUnauthorizedError"
  }
}
