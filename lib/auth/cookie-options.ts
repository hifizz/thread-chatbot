import { DEFAULT_AUTH_COOKIE_PREFIX } from "@/constants/auth"

/** 仅描述 Cookie 名称，不验证会话；权限仍由服务端数据库会话判定。 */
export function getAuthCookieOptions() {
  return {
    cookiePrefix: process.env.BETTER_AUTH_COOKIE_PREFIX?.trim() || DEFAULT_AUTH_COOKIE_PREFIX,
  }
}
