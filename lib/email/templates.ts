import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "@/constants/i18n"
import { createTranslator, type MessageKey } from "@/lib/i18n/dictionary"
import { resolveLocale } from "@/lib/i18n/resolve-locale"

export type TransactionalEmail = { subject: string; html: string; text: string }
export type LocalizedEmailInput =
  | { locale: Locale; template: "beta-invite"; variables: { url: string; expiresAt: string } }
  | { locale: Locale; template: "invite-expired"; variables: { url: string } }
  | { locale: Locale; template: "credit-low"; variables: { url: string; balance: string } }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!))
}

function render(locale: Locale, prefix: "verify" | "reset" | "invite" | "expired" | "credit", url: string, variables: Record<string, string> = {}): TransactionalEmail {
  const target = new URL(url)
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) throw new Error("INVALID_EMAIL_URL")
  const t = createTranslator(locale)
  const subject = t(`email.${prefix}Subject` as MessageKey)
  const title = t(`email.${prefix}Title` as MessageKey)
  const body = t(`email.${prefix}Body` as MessageKey, variables)
  const label = t(`email.${prefix}Action` as MessageKey)
  const footer = t("email.footer")
  const fallback = t("email.fallback")
  return {
    subject,
    text: `${title}\n\n${body}\n\n${label}: ${target.href}\n\n${footer}`,
    html: `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif"><div style="max-width:480px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border-radius:14px;padding:32px"><h1 style="font-size:18px">ThreadChat</h1><h2 style="font-size:16px">${escapeHtml(title)}</h2><p style="line-height:1.6">${escapeHtml(body)}</p><p><a href="${escapeHtml(target.href)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px">${escapeHtml(label)}</a></p><p style="font-size:12px">${escapeHtml(fallback)}<br>${escapeHtml(target.href)}</p></div><p style="font-size:12px;text-align:center">${escapeHtml(footer)}</p></div></body></html>`,
  }
}

export function verificationEmail(url: string, locale: Locale = DEFAULT_LOCALE): TransactionalEmail {
  return render(locale, "verify", url)
}
export function resetPasswordEmail(url: string, locale: Locale = DEFAULT_LOCALE): TransactionalEmail {
  return render(locale, "reset", url)
}
export function localizedEmail(input: LocalizedEmailInput): TransactionalEmail {
  if (input.template === "beta-invite") return render(input.locale, "invite", input.variables.url, { expiresAt: input.variables.expiresAt })
  if (input.template === "credit-low") return render(input.locale, "credit", input.variables.url, { balance: input.variables.balance })
  return render(input.locale, "expired", input.variables.url)
}

export function authEmailLocale(profile: unknown, request?: Request): Locale {
  let cookie: string | undefined
  const value = request?.headers.get("cookie")?.split(";").find((part) => part.trim().startsWith(`${LOCALE_COOKIE}=`))?.trim().slice(LOCALE_COOKIE.length + 1)
  try { cookie = value === undefined ? undefined : decodeURIComponent(value) } catch { cookie = undefined }
  return resolveLocale({ profile, cookie, acceptLanguage: request?.headers.get("accept-language") }).locale
}
