import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"
import { ROUTES } from "@/constants/routes"

// 乐观鉴权：仅检查会话 cookie 是否存在（不做数据库校验，避免 Edge 开销）。
// 真正的会话有效性由各 API 路由 / 服务端再次校验。
// Next 16 已将 middleware 约定重命名为 proxy（同签名）。
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSession = getSessionCookie(request) != null

  // 无需登录即可访问的页面（公开落地页 + 登录/注册/找回密码 + 法务页）
  const publicPages = new Set([
    ROUTES.landing, // 公开落地页：登出访客也要能看到（获客页）
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/terms",
    "/privacy",
    "/refund",
  ])
  const isAuthPage = publicPages.has(pathname)

  // 注意：这里「不」再因为「有 cookie」就把用户从登录/注册页弹回首页。
  // 中间件只做乐观 cookie 检查（不查库），而 cookie 可能是失效的「幽灵」（过期/被撤销/
  // 用户被删/本地库重置）——若在此乐观弹走，用户就会被永远挡在登录页外，且所有 API 仍 401，
  // 形成死循环。改由登录页客户端用 useSession（真查会话）来决定：确属已登录才跳走，
  // 失效 cookie 则留在登录页正常重登（新 cookie 覆盖旧的）。

  // 未登录访问受保护页面（首页对话）→ 去登录页，并带上回跳地址
  if (!hasSession && !isAuthPage) {
    const url = new URL("/sign-in", request.url)
    url.searchParams.set("redirect", pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // 仅拦截页面路由：排除 api、静态资源、图片等。
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|favicon).*)"],
}
