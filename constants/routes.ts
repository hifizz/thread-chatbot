// 应用路由与登录后落点的单一事实来源——避免 "/thread-chat" 等字面量散落在
// 落地页 CTA、旗舰门禁、auth-form 三处（CLAUDE.md 的「扫魔法串/去重」纪律）。

/** 应用主要路由。 */
export const ROUTES = {
  landing: "/",
  startChat: "/start-chat",
  flagship: "/thread-chat", // 旗舰跳板（裸路径 → /thread-chat/{uuid}）
  signIn: "/sign-in",
  account: "/account",
} as const

export type RouteKey = keyof typeof ROUTES

/** 登录/注册成功且 URL 无 redirect 参数时的默认落点。 */
export const DEFAULT_AUTHED_REDIRECT: string = ROUTES.flagship

/** 构造带回跳的登录地址（redirect 目标做 URL 编码）。 */
export function signInWithRedirect(target: string): string {
  return `${ROUTES.signIn}?redirect=${encodeURIComponent(target)}`
}

/** 构造指定分支树的工作台路由；UUID 合法性由目标页面统一校验。 */
export function threadTreeRoute(treeId: string): `/thread-chat/${string}` {
  return `/thread-chat/${treeId}`
}
