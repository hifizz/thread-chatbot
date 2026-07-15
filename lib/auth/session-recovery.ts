"use client"

import { signOut } from "@/lib/auth/client"

// 会话失效自救：当受保护的业务 API 返回 401 时，说明浏览器里的会话 cookie 已经失效
// （过期 / 被撤销 / 用户被删 / 本地库被重置）。此时应主动登出清掉那张「幽灵 cookie」，
// 再带上回跳地址跳到登录页——否则乐观鉴权的中间件会认为「有 cookie = 已登录」，
// 把用户永远挡在登录页之外（死循环）。
//
// 注意：只在自己的业务 API（threads / chat / branch-trees…）上用它。better-auth 自身的
// 登录/会话接口（/api/auth/*）也会返回 401（比如密码错误），绝不能包进来，否则会把一次
// 失败登录变成一次跳转。

// 同一次页面生命周期内只跳一次，避免多个并发 401 触发多次登出/跳转。
let recovering = false

/** 登出清 cookie 后跳登录页（带回跳）。幂等：并发 401 只会触发一次。 */
export async function handleUnauthorized(): Promise<void> {
  if (typeof window === "undefined") return
  if (recovering) return
  recovering = true

  // 尽力登出以拿到服务端「清 cookie」的 Set-Cookie；失败也无妨——下面硬跳转到登录页，
  // 登录页已不再被中间件乐观弹走，用户重新登录会用新 cookie 覆盖旧的。
  try {
    await signOut()
  } catch {
    // 会话本就无效，登出失败可忽略
  }

  const from = window.location.pathname + window.location.search
  // 硬跳转（而非 router.push）：让中间件带着已清掉的 cookie 重新判定。
  window.location.href = `/sign-in?redirect=${encodeURIComponent(from)}`
}

/**
 * fetch 包装：透传结果，但一旦命中 401 就触发会话自救（登出 + 跳登录）。
 * 仍原样返回 response，调用方既有的错误处理（失败态/降级）照常生效，跳转在后台进行。
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) void handleUnauthorized()
  return res
}
