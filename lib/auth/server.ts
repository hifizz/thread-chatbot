import { headers } from "next/headers"
import { auth } from "@/lib/auth"

// 服务端读取当前会话/用户。API 路由用它做真正的鉴权校验（中间件只做乐观 cookie 检查）。

export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

/** 返回当前登录用户 id，未登录返回 null。 */
export async function getCurrentUserId(): Promise<string | null> {
  const s = await getSession()
  return s?.user.id ?? null
}
