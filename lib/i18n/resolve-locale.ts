import { DEFAULT_LOCALE, LOCALE_COOKIE, SUPPORTED_LOCALES, type Locale } from "@/constants/i18n"

export type LocalePreference = {
  locale: Locale
  source: "profile" | "cookie" | "accept-language" | "default"
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.some((locale) => locale === value)
}

/** 仅处理允许的语言范围。无效 q 值不应意外升级到 q=1。 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  const ranges = (header ?? "").slice(0, 4096).split(",").flatMap((part, index) => {
    const [rawTag, ...parameters] = part.trim().toLowerCase().split(";")
    if (!/^(?:[a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)$/.test(rawTag)) return []
    let quality = 1
    if (parameters.length) {
      if (parameters.length !== 1) return []
      const match = /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/.exec(parameters[0])
      if (!match) return []
      quality = Number(match[1])
    }
    const locale: Locale | null = /^zh(?:-|$)/.test(rawTag) ? "zh-CN" : /^en(?:-|$)/.test(rawTag) ? "en" : null
    return [{ rawTag, locale, quality, index }]
  })
  const excluded = new Set(ranges.filter((range) => range.quality === 0).map((range) => range.locale))
  const accepted = ranges.filter((range) => range.quality > 0).sort((a, b) => b.quality - a.quality || a.index - b.index)
  for (const range of accepted) {
    if (range.locale) return range.locale
    if (range.rawTag === "*") {
      const match = ([DEFAULT_LOCALE, "zh-CN"] as const).find((locale) => !excluded.has(locale))
      if (match) return match
    }
  }
  return null
}

export function resolveLocale(input: {
  profile?: unknown
  cookie?: unknown
  acceptLanguage?: string | null
}): LocalePreference {
  if (isLocale(input.profile)) return { locale: input.profile, source: "profile" }
  if (isLocale(input.cookie)) return { locale: input.cookie, source: "cookie" }
  const locale = matchAcceptLanguage(input.acceptLanguage)
  return locale ? { locale, source: "accept-language" } : { locale: DEFAULT_LOCALE, source: "default" }
}

export function localeCookieValue(headers: Headers): string | undefined {
  const raw = headers.get("cookie")?.split(";").find((part) => part.trim().startsWith(`${LOCALE_COOKIE}=`))?.trim().slice(LOCALE_COOKIE.length + 1)
  try { return raw === undefined ? undefined : decodeURIComponent(raw) } catch { return undefined }
}
