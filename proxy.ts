import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

// 乐观鉴权：仅检查会话 cookie 是否存在（不做数据库校验，避免 Edge 开销）。
// 真正的会话有效性由各 API 路由 / 服务端再次校验。
// Next 16 已将 middleware 约定重命名为 proxy（同签名）。
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSession = getSessionCookie(request) != null

  const isAuthPage = pathname === "/sign-in" || pathname === "/sign-up"

  // 已登录用户访问登录/注册页 → 回到首页
  if (hasSession && isAuthPage) {
    return NextResponse.redirect(new URL("/", request.url))
  }

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
