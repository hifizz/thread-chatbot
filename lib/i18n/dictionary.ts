import type { Locale } from "@/constants/i18n"
import zh from "@/messages/zh-CN.json"
import en from "@/messages/en.json"

export type Messages = typeof zh
export type MessageKey = keyof Messages
export type MessageVariables = Readonly<Record<string, string | number>>
const dictionaries: Record<Locale, Messages> = { "zh-CN": zh, en }

export function getDictionary(locale: Locale): Messages {
  return dictionaries[locale]
}

export function interpolate(message: string, variables: MessageVariables = {}): string {
  return message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) throw new Error(`MISSING_MESSAGE_VARIABLE:${name}`)
    return String(variables[name])
  })
}

export function createTranslator(locale: Locale) {
  const dictionary = getDictionary(locale)
  return (key: MessageKey, variables?: MessageVariables): string => {
    const message = dictionary[key]
    if (typeof message !== "string") throw new Error(`MISSING_TRANSLATION:${key}`)
    return interpolate(message, variables)
  }
}

export function formatCredit(locale: Locale, micros: number, fractionDigits = 2): string {
  if (!Number.isSafeInteger(micros)) throw new RangeError("INVALID_CNY_MICROS")
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: "CNY", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
  }).format(micros / 1_000_000)
}

export function formatTimestamp(locale: Locale, value: string | Date | null, timeZone = "UTC"): string {
  if (!value) return "—"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "—"
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date)
}

export function formatRelativeTime(locale: Locale, value: string, now: number): string {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return "—"
  const seconds = Math.round((time - now) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  if (Math.abs(seconds) < 60) return createTranslator(locale)("ui.justNow")
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute")
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour")
  if (Math.abs(seconds) < 30 * 86400) return formatter.format(Math.round(seconds / 86400), "day")
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(time))
}
