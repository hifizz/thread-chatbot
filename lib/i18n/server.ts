import { cache } from "react"
import { cookies, headers } from "next/headers"
import { LOCALE_COOKIE } from "@/constants/i18n"
import { getSession } from "@/lib/auth/server"
import { localeCookieValue, resolveLocale } from "./resolve-locale"
import { createTranslator } from "./dictionary"

/** React cache 只在当前 RSC 请求内复用，不能放入跨用户的 unstable_cache。 */
export const getRequestLocaleContext = cache(async () => {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()])
  const session = await getSession(requestHeaders)
  const preference = resolveLocale({
    profile: session?.user.locale,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  })
  return { ...preference, identity: session?.user.id ?? "anonymous" }
})

export async function getRequestLocale() {
  return (await getRequestLocaleContext()).locale
}

export async function getTranslator() {
  return createTranslator(await getRequestLocale())
}

/** HTTP 发起时冻结语言信号，后台执行不读取浏览器或变动中的账户偏好。 */
export async function getHttpLocale(request: Request) {
  const session = await getSession(request.headers)
  return resolveLocale({ profile: session?.user.locale, cookie: localeCookieValue(request.headers), acceptLanguage: request.headers.get("accept-language") }).locale
}
