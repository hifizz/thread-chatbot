import type { Locale } from "@/constants/i18n"
import { createTranslator, type MessageKey } from "./dictionary"

const ERROR_MESSAGES: Record<string, MessageKey> = {
  CONTEXT_LIMIT_EXCEEDED: "documentUi.contextLimit",
  VALIDATION_ERROR: "errors.validation", NOT_FOUND: "errors.notFound", STATE_CONFLICT: "errors.conflict",
  COMMAND_ID_CONFLICT: "errors.conflict", CREDIT_EXHAUSTED: "errors.creditExhausted",
  RUN_RESERVATION_INSUFFICIENT: "errors.reserveInsufficient", MODEL_PRICING_UNAVAILABLE: "errors.modelPricing",
  MODEL_NOT_ALLOWED: "errors.modelRestricted", PRO_REQUIRED: "errors.modelRestricted",
  TOO_MANY_ACTIVE_RUNS: "errors.tooManyRuns", CAPACITY_UNAVAILABLE: "errors.capacity",
  WEB_PROVIDER_ERROR: "errors.search", WEB_TIMEOUT: "errors.search", WEB_BUDGET_EXHAUSTED: "errors.search",
  GENERATION_FAILED: "errors.generation", SESSION_NOT_AVAILABLE: "errors.session",
  INVALID_EMAIL_OR_PASSWORD: "errors.auth", INVALID_PASSWORD: "errors.auth",
  EMAIL_NOT_VERIFIED: "errors.verify", ORIGIN_NOT_ALLOWED: "errors.origin",
  BETA_ACCESS_REQUIRED: "errors.beta", INVITE_INVALID: "errors.invite", ACCOUNT_SUSPENDED: "errors.suspended",
  RATE_LIMITED: "errors.rateLimited", TOPUP_DISABLED: "errors.topupDisabled", LOCALE_SYNC_FAILED: "locale.deviceOnly",
}

export function publicErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const value = error as Record<string, unknown>
  if (typeof value.code === "string") return value.code
  for (const nested of [value.error, value.detail]) {
    if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).code === "string") return (nested as Record<string, unknown>).code as string
  }
  return null
}

/** 未知错误也只返回产品文案，不回显任意 error.message。 */
export function localizeError(locale: Locale, error: unknown): string {
  const code = typeof error === "string" ? error : publicErrorCode(error)
  return createTranslator(locale)(code && ERROR_MESSAGES[code] || "errors.generic")
}
